package main

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

func read(t *testing.T, sql string) ([]relation, []string) {
	t.Helper()

	relations, _, unread, err := readDDL(sql, "test.sql")
	if err != nil {
		t.Fatal(err)
	}

	return relations, unread
}

func TestColumnsKeysAndNullability(t *testing.T) {
	relations, _ := read(t, `
CREATE TABLE users (
    id            text        PRIMARY KEY,
    email         text        NOT NULL,
    nickname      text,
    version       bigint      NOT NULL
);`)

	if len(relations) != 1 {
		t.Fatalf("expected one table, got %d", len(relations))
	}

	got := map[string]catalog.Column{}
	for _, column := range relations[0].table.Columns {
		got[column.Name] = column
	}

	if !got["id"].PK {
		t.Error("id is the primary key")
	}
	// A primary key is not null whether or not anybody wrote it down.
	if got["id"].Nullable {
		t.Error("a primary key is never nullable")
	}
	if got["email"].Nullable {
		t.Error("email is NOT NULL")
	}
	if !got["nickname"].Nullable {
		t.Error("nickname has no constraint, so it is nullable")
	}
}

// The grammar normalises the standard names to PostgreSQL's internal ones. The
// catalog asks for the type as declared, so they are put back.
func TestTypesKeepTheirWrittenSpelling(t *testing.T) {
	relations, _ := read(t, `
CREATE TABLE t (
    a bigint,
    b timestamptz,
    c boolean,
    d char(3),
    e jsonb
);`)

	want := map[string]string{
		"a": "bigint",
		"b": "timestamptz",
		"c": "boolean",
		"d": "char(3)",
		"e": "jsonb",
	}

	for _, column := range relations[0].table.Columns {
		if got := column.Type; got != want[column.Name] {
			t.Errorf("%s: type = %q, want %q", column.Name, got, want[column.Name])
		}
	}
}

func TestTableLevelPrimaryKey(t *testing.T) {
	relations, _ := read(t, `
CREATE TABLE order_items (
    order_id uuid NOT NULL,
    line_no  integer NOT NULL,
    PRIMARY KEY (order_id, line_no)
);`)

	for _, column := range relations[0].table.Columns {
		if !column.PK {
			t.Errorf("%s is part of the composite key", column.Name)
		}
	}
}

func TestForeignKey(t *testing.T) {
	relations, _ := read(t, `
CREATE TABLE lines (
    id       uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE
);`)

	var fk *catalog.FK
	for _, column := range relations[0].table.Columns {
		if column.Name == "order_id" {
			fk = column.FK
		}
	}

	if fk == nil {
		t.Fatal("order_id has a foreign key")
	}
	if fk.Table != "orders" || fk.Column != "id" || fk.OnDelete != "cascade" {
		t.Errorf("fk = %+v", fk)
	}
}

func TestIndexesCarryTheirColumnsAndUniqueness(t *testing.T) {
	relations, _ := read(t, `
CREATE TABLE sessions (id text PRIMARY KEY, user_id text, issued_at timestamptz);
CREATE UNIQUE INDEX sessions_token_key ON sessions (id);
CREATE INDEX sessions_user_id_idx ON sessions (user_id, issued_at);`)

	indexes := relations[0].indexes
	if len(indexes) != 2 {
		t.Fatalf("expected two indexes, got %d", len(indexes))
	}
	if !indexes[0].Unique || indexes[0].Name != "sessions_token_key" {
		t.Errorf("first index = %+v", indexes[0])
	}
	if indexes[1].Unique || strings.Join(indexes[1].Columns, ",") != "user_id,issued_at" {
		t.Errorf("second index = %+v", indexes[1])
	}
}

// A migration this reader does not model is reported. Quietly skipping one
// would leave the catalog confidently wrong about the schema.
func TestUnreadStatementsAreReported(t *testing.T) {
	_, unread := read(t, `
CREATE TABLE t (id text PRIMARY KEY);
ALTER TABLE t ADD COLUMN extra text;
CREATE INDEX elsewhere_idx ON other_table (id);`)

	if len(unread) != 2 {
		t.Fatalf("expected two notes, got %v", unread)
	}
	if !strings.Contains(strings.Join(unread, " "), "AlterTableStmt") {
		t.Errorf("the ALTER should be named: %v", unread)
	}
	if !strings.Contains(strings.Join(unread, " "), "other_table") {
		t.Errorf("an index on a table from another file should be named: %v", unread)
	}
}

// A view is the other half of what a migration builds, and the half a table
// cannot express: no key, no constraints, and what it reads instead.
func TestReadsAViewAndWhereItsColumnsComeFrom(t *testing.T) {
	sql := `
CREATE TABLE payments (id text PRIMARY KEY, order_id text NOT NULL, amount_minor bigint NOT NULL);
CREATE TABLE refunds (id text PRIMARY KEY, payment_id text NOT NULL, amount_minor bigint NOT NULL);
CREATE VIEW v_payment_state AS
SELECT p.id AS payment_id, p.order_id, coalesce(sum(r.amount_minor), 0) AS refunded_minor
  FROM payments p
  LEFT JOIN refunds r ON r.payment_id = p.id
 GROUP BY p.id;
`

	_, views, unread, err := readDDL(sql, "test.sql")
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 0 {
		t.Fatalf("nothing should be left unread: %v", unread)
	}
	if len(views) != 1 {
		t.Fatalf("want one view, got %d", len(views))
	}

	view := views[0]
	if view.name != "v_payment_state" {
		t.Errorf("name %q", view.name)
	}
	if strings.Join(view.reads, ",") != "payments,refunds" {
		t.Errorf("reads %v", view.reads)
	}

	want := map[string]string{
		"payment_id":     "payments.id",
		"order_id":       "payments.order_id",
		"refunded_minor": "refunds.amount_minor",
	}
	if len(view.columns) != len(want) {
		t.Fatalf("columns %v", view.columns)
	}
	for _, column := range view.columns {
		if strings.Join(column.from, ",") != want[column.name] {
			t.Errorf("%s comes from %v, want %q", column.name, column.from, want[column.name])
		}
	}

	// The definition is the SQL somebody wrote, not the tree printed back.
	if !strings.HasPrefix(view.definition, "CREATE VIEW v_payment_state AS") || !strings.HasSuffix(view.definition, ";") {
		t.Errorf("definition %q", view.definition)
	}
}
