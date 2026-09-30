package extractsql

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestTableNamesFollowTheLibrariesRules(t *testing.T) {
	gorm := gormNaming{}
	for name, want := range map[string]string{
		"OrderLine":   "order_lines",
		"UserID":      "user_ids",
		"HTTPRequest": "http_requests",
		"APIKey":      "api_keys",
		"Category":    "categories",
		"Person":      "people",
		"Status":      "statuses",
		"Address":     "addresses",
		"Box":         "boxes",
		"Sheep":       "sheep",
	} {
		if got := gorm.table(name); got != want {
			t.Errorf("gorm %s = %q, want %q", name, got, want)
		}
	}
	if got := (gormNaming{prefix: "shop_", singular: true}).table("OrderLine"); got != "shop_order_line" {
		t.Errorf("gorm with a literal strategy = %q", got)
	}
	for name, want := range map[string]string{
		"OrderLine":   "order_lines",
		"Category":    "categories",
		"Person":      "people",
		"HTTPRequest": "http_requests",
	} {
		if got := entTable(name); got != want {
			t.Errorf("ent %s = %q, want %q", name, got, want)
		}
	}
}

func extractTree(t *testing.T, files map[string]string) (map[string]catalog.Table, []string) {
	t.Helper()
	root := writeTree(t, files)
	response := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "orders"})
	var got catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}
	tables := map[string]catalog.Table{}
	for _, store := range got.Stores {
		for _, table := range store.Tables {
			tables[table.Name] = table
		}
	}
	var warnings []string
	for _, warning := range response.Warnings() {
		warnings = append(warnings, warning.Message)
	}
	return tables, warnings
}

func accessList(table catalog.Table) string {
	var out []string
	for _, access := range table.Accesses {
		out = append(out, string(access.Operation)+" "+access.Method)
	}
	return strings.Join(out, ", ")
}

func hasWarning(warnings []string, parts ...string) bool {
	for _, warning := range warnings {
		all := true
		for _, part := range parts {
			all = all && strings.Contains(warning, part)
		}
		if all {
			return true
		}
	}
	return false
}

func TestGormReportsWhatItCannotName(t *testing.T) {
	tables, warnings := extractTree(t, map[string]string{
		"go.mod":             "module example.com/g\n",
		"migrations/001.sql": "CREATE TABLE orders (id uuid PRIMARY KEY);",
		"store/orders.go": `package store

import (
	"gorm.io/gorm"
	"example.com/elsewhere/model"
)

type Order struct{ ID string }

type Ledger struct{ ID string }

type Named struct{ table string }

func (n Named) TableName() string { return n.table }

type Orders struct{ db *gorm.DB }

func (o *Orders) Dynamic(name string) { o.db.Table(name).Find(&[]Order{}) }
func (o *Orders) Foreign() { o.db.Create(&model.Order{}) }
func (o *Orders) FromField() { o.db.First(&Named{}) }
func (o *Orders) Unmigrated() { o.db.Save(&Ledger{}) }
func (o *Orders) Known() { o.db.Where("id = ?", 1).Delete(&Order{}) }
`,
	})
	if got := accessList(tables["orders"]); got != "delete Orders.Known" {
		t.Errorf("orders accesses = %s", got)
	}
	for _, want := range [][]string{
		{"Table()", "store/orders.go:18", "not a constant"},
		{"model Order is not declared", "access at store/orders.go:19"},
		{"Named.TableName() does not return a constant", "access at store/orders.go:20"},
		{"gorm in Orders.Unmigrated names table ledgers", "no migration"},
	} {
		if !hasWarning(warnings, want...) {
			t.Errorf("no warning with %q in %q", want, warnings)
		}
	}
}

func TestGormAppliesOnlyALiteralNamingStrategy(t *testing.T) {
	files := map[string]string{
		"go.mod":             "module example.com/g\n",
		"migrations/001.sql": "CREATE TABLE shop_order_line (id uuid PRIMARY KEY);",
		"store/lines.go": `package store

import "gorm.io/gorm"

type OrderLine struct{ ID string }

type Lines struct{ db *gorm.DB }

func (l *Lines) All(tx *gorm.DB) { tx.Find(&[]OrderLine{}) }
`,
		"cmd/main.go": `package main

import (
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func main() {
	gorm.Open(nil, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "shop_", SingularTable: true}})
}
`,
	}
	tables, warnings := extractTree(t, files)
	if got := accessList(tables["shop_order_line"]); got != "read Lines.All" || len(warnings) != 0 {
		t.Errorf("literal strategy: accesses %q, warnings %q", got, warnings)
	}

	files["cmd/main.go"] = strings.Replace(files["cmd/main.go"], `TablePrefix: "shop_"`, `TablePrefix: prefix()`, 1) + "\nfunc prefix() string { return envPrefix }\n\nvar envPrefix string\n"
	tables, warnings = extractTree(t, files)
	if len(tables["shop_order_line"].Accesses) != 0 || !hasWarning(warnings, "TablePrefix", "not a constant") {
		t.Errorf("non-literal strategy: accesses %+v, warnings %q", tables["shop_order_line"].Accesses, warnings)
	}
}

func TestSqlxIsRecognisedByItsImportNotByMethodNames(t *testing.T) {
	tables, warnings := extractTree(t, map[string]string{
		"go.mod": "module example.com/x\n",
		"internal/user/infrastructure/repository/migrations/001.sql": "CREATE TABLE users (id uuid PRIMARY KEY);",
		// Outside the repository package and without sqlx: nobody's query.
		"internal/http/client.go": `package http

type client struct{}

func (c client) Get(dest any, url string) {}

func Fetch() { client{}.Get(nil, "SELECT id FROM users") }
`,
		"internal/user/store/users.go": `package store

import (
	"fmt"

	sq "github.com/Masterminds/squirrel"
	"github.com/jmoiron/sqlx"
)

type Users struct{ db *sqlx.DB }

func (u *Users) ByID(id string) { u.db.Get(nil, "SELECT id FROM users WHERE id = $1", id) }
func (u *Users) Built() {
	query, args, _ := sq.Select("id").From("users").ToSql()
	u.db.Select(nil, query, args...)
}
func (u *Users) Formatted(table string) { u.db.Get(nil, fmt.Sprintf("SELECT id FROM %s", table)) }
`,
	})
	if got := accessList(tables["users"]); got != "read Users.Built, read Users.ByID" {
		t.Errorf("users accesses = %s", got)
	}
	if len(warnings) != 1 || !hasWarning(warnings, "sqlx", "Get", "store/users.go:17", "not a constant") {
		t.Errorf("warnings = %q", warnings)
	}
}

func TestSquirrelAndEntReportUnresolvedTables(t *testing.T) {
	_, warnings := extractTree(t, map[string]string{
		"go.mod":             "module example.com/b\n",
		"migrations/001.sql": "CREATE TABLE orders (id uuid PRIMARY KEY);",
		"store/orders.go": `package store

import sq "github.com/Masterminds/squirrel"

func Query(table string) { sq.Select("id").From(table).ToSql() }
`,
		"ent/schema/order.go": `package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
)

type Order struct{ ent.Schema }

func (Order) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: tableName()}}
}

func tableName() string { return someVar }

var someVar string
`,
	})
	for _, want := range [][]string{
		{"squirrel", "From", "store/orders.go:5", "not a constant"},
		{"ent", "Order", "ent/schema/order.go:12", "not a constant"},
	} {
		if !hasWarning(warnings, want...) {
			t.Errorf("no warning with %q in %q", want, warnings)
		}
	}
}
