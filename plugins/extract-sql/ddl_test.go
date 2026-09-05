package main

import (
	"fmt"
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
	relations, unread := read(t, `
CREATE TABLE t (id text PRIMARY KEY);
ALTER TABLE t ADD COLUMN extra text;
CREATE INDEX elsewhere_idx ON other_table (id);`)

	if len(unread) != 1 {
		t.Fatalf("expected one note, got %v", unread)
	}
	if got := relations[0].table.Columns[1].Name; got != "extra" {
		t.Errorf("ALTER ADD COLUMN was not applied: %q", got)
	}
	if !strings.Contains(strings.Join(unread, " "), "other_table") {
		t.Errorf("an index on a table from another file should be named: %v", unread)
	}
}

func TestMigrationsBuildFinalSchemaState(t *testing.T) {
	state := newDDLState()
	steps := []string{
		`CREATE TABLE accounts (id uuid PRIMARY KEY, email text, obsolete text);`,
		`ALTER TABLE accounts ADD COLUMN version integer NOT NULL;
         ALTER TABLE accounts ALTER COLUMN email SET NOT NULL;
         CREATE UNIQUE INDEX accounts_email_key ON accounts (email);`,
		`ALTER TABLE accounts RENAME COLUMN email TO login;
         ALTER TABLE accounts ALTER COLUMN version TYPE bigint;
         ALTER TABLE accounts DROP COLUMN obsolete;
         ALTER TABLE accounts RENAME TO users;`,
	}
	for i, sql := range steps {
		unread, err := state.apply(sql, fmt.Sprintf("%03d.sql", i+1))
		if err != nil {
			t.Fatal(err)
		}
		if len(unread) != 0 {
			t.Fatalf("migration %d left unread DDL: %v", i+1, unread)
		}
	}

	if len(state.relations) != 1 || state.relations[0].table.Name != "users" {
		t.Fatalf("relations = %+v", state.relations)
	}
	r := state.relations[0]
	if len(r.table.Columns) != 3 {
		t.Fatalf("columns = %+v", r.table.Columns)
	}
	want := map[string]string{"id": "uuid", "login": "text", "version": "bigint"}
	for _, column := range r.table.Columns {
		if column.Type != want[column.Name] {
			t.Errorf("column %s type = %q, want %q", column.Name, column.Type, want[column.Name])
		}
		if column.Name == "login" && column.Nullable {
			t.Error("renamed login column lost NOT NULL")
		}
	}
	if len(r.indexes) != 1 || strings.Join(r.indexes[0].Columns, ",") != "login" {
		t.Errorf("index did not follow renamed column: %+v", r.indexes)
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

// A column copied from another service's row is a fact the migration declares,
// because the statement that creates the column cannot show it.
func TestReadsWhereACopiedColumnCameFrom(t *testing.T) {
	sql := `
CREATE TABLE packages (
    id       text NOT NULL PRIMARY KEY,
    -- from: shop.oms.pg.orders.ship_to
    ship_to  text NOT NULL,
    -- from: packages.id
    label_of text NOT NULL,
    weight_g integer NOT NULL
);
`

	copies := readCopies(sql, "delivery.core.pg")

	if got := strings.Join(copies["packages"]["ship_to"], ","); got != "shop.oms.pg.orders.ship_to" {
		t.Errorf("ship_to came from %q", got)
	}
	// A column of this store may be named without it.
	if got := strings.Join(copies["packages"]["label_of"], ","); got != "delivery.core.pg.packages.id" {
		t.Errorf("label_of came from %q", got)
	}
	if _, said := copies["packages"]["weight_g"]; said {
		t.Error("a column with no comment above it says nothing")
	}
	if _, said := copies["packages"]["id"]; said {
		t.Error("the comment belongs to the column under it, not the one before")
	}
}

// The other spelling of a view: the grammar calls it a CREATE TABLE AS whose
// object is a matview, and the difference a reader needs is that the rows are
// kept and can be stale.
func TestReadsAMaterializedView(t *testing.T) {
	sql := `
CREATE TABLE routes (id text PRIMARY KEY, planned_for date NOT NULL);
CREATE TABLE route_stops (route_id text NOT NULL, seq integer NOT NULL);
CREATE MATERIALIZED VIEW mv_route_load AS
SELECT r.id AS route_id, count(s.seq) AS stops
  FROM routes r LEFT JOIN route_stops s ON s.route_id = r.id
 GROUP BY r.id;
`

	_, views, unread, err := readDDL(sql, "test.sql")
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 0 {
		t.Fatalf("nothing should be left unread: %v", unread)
	}
	if len(views) != 1 || !views[0].materialized {
		t.Fatalf("views = %+v", views)
	}
	if strings.Join(views[0].reads, ",") != "routes,route_stops" {
		t.Errorf("reads %v", views[0].reads)
	}
	if !strings.HasPrefix(views[0].definition, "CREATE MATERIALIZED VIEW mv_route_load AS") {
		t.Errorf("definition %q", views[0].definition)
	}
}
