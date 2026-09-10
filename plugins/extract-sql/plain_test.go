package extractsql

import (
	"encoding/json"
	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"testing"
)

func TestPlainMigrationsDoNotInventAnAggregate(t *testing.T) {
	for _, dir := range []string{"migrations", "store/migrations", "internal/storage/migrations", "internal/infrastructure/repository/order/migrations"} {
		for _, explicit := range []bool{false, true} {
			t.Run(dir, func(t *testing.T) {
				root := writeTree(t, map[string]string{
					"go.mod":         "module example.com/plain\n",
					dir + "/001.sql": `CREATE TABLE orders (id uuid PRIMARY KEY); CREATE TABLE order_lines (order_id uuid REFERENCES orders(id)); CREATE VIEW recent_orders AS SELECT id FROM orders;`,
				})
				opts := Options{Context: "shop", Service: "orders"}
				if explicit {
					opts.Repositories = dir
				}
				response := extract(plugin.Input{Root: root}, opts)
				var got catalog.Catalog
				if err := json.Unmarshal([]byte(response.Files[0].Contents), &got); err != nil {
					t.Fatal(err)
				}
				if len(got.Stores) != 1 || len(got.Stores[0].Tables) != 2 || len(got.Stores[0].Views) != 1 {
					t.Fatalf("schema lost: %+v", got.Stores)
				}
				for _, table := range got.Stores[0].Tables {
					if table.Persists != nil || table.Role != "" {
						t.Fatalf("invented domain link: %+v", table)
					}
					if len(table.Evidence) != 1 || table.Evidence[0].Source != dir+"/001.sql" {
						t.Fatalf("DDL provenance missing: %+v", table)
					}
				}
				if got.Stores[0].Views[0].Persists != nil {
					t.Fatal("view inherited nonexistent aggregate")
				}
				if len(response.Warnings()) != 0 {
					t.Fatalf("warnings = %+v", response.Warnings())
				}
			})
		}
	}
}

func TestExplicitMigrationAssociationIsRetained(t *testing.T) {
	root := writeTree(t, map[string]string{"migrations/001.sql": "-- aggregate: shop.sales.order\nCREATE TABLE orders(id uuid PRIMARY KEY);\n"})
	response := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "orders"})
	var got catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}
	persists := got.Stores[0].Tables[0].Persists
	if persists == nil || persists.Aggregate != "shop.sales.order" || persists.Evidence[0].Rule != "migration-aggregate-annotation" || persists.Evidence[0].Source != "migrations/001.sql" {
		t.Fatalf("association = %+v", persists)
	}
}

func TestPlainMigrationsFindSQLCallersElsewhereInModule(t *testing.T) {
	root := writeTree(t, map[string]string{
		"go.mod":             "module example.com/plain\n",
		"migrations/001.sql": "CREATE TABLE orders(id uuid PRIMARY KEY);",
		"storage/orders.go": `package storage
import "database/sql"
type Orders struct { db *sql.DB }
func (o *Orders) Save(id string) { o.db.Exec("INSERT INTO orders(id) VALUES ($1)", id) }
`,
	})
	response := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "orders"})
	var got catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}
	table := got.Stores[0].Tables[0]
	if table.Persists != nil || len(table.Accesses) != 1 || table.Accesses[0].Method != "Orders.Save" || table.Accesses[0].Operation != catalog.TableOperationWrite {
		t.Fatalf("SQL access lost or domain invented: %+v", table)
	}
}
