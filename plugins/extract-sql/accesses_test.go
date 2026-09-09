package extractsql

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestReadsWhoReadsAndWritesPostgresTables(t *testing.T) {
	root := writeTree(t, map[string]string{
		"internal/order/infrastructure/repository/migrations/0001_orders.sql": `
CREATE TABLE orders (id uuid PRIMARY KEY, state text NOT NULL);
CREATE TABLE order_lines (order_id uuid NOT NULL, sku text NOT NULL);`,
		"internal/order/infrastructure/repository/postgres.go": `package order

const columns = "id, state"

type Postgres struct{}

func (p *Postgres) Save() {
	p.Exec("INSERT INTO orders (" + columns + ") VALUES ($1, $2)")
	p.Exec("UPDATE order_lines SET sku = $1 WHERE order_id = $2")
}

func (p *Postgres) ByID(where string) {
	p.one(where)
}

func (p *Postgres) one(where string) {
	p.QueryRow("SELECT " + columns + " FROM orders " + where)
}

func (p *Postgres) WithLines() {
	p.Query("SELECT o.id FROM orders o JOIN order_lines l ON l.order_id = o.id")
}

func (p *Postgres) Remove() {
	p.Exec("DELETE FROM order_lines WHERE order_id = $1")
}`,
	})

	layout := discoverStorageLayout(root, "", "")
	tables, _ := readStore(root, layout, "shop.order.pg", "shop.order", nilBuilder())
	byName := map[string]catalog.Table{}
	for _, table := range tables {
		byName[table.Name] = table
	}

	orders := byName["orders"].Accesses
	if len(orders) != 3 {
		t.Fatalf("orders accesses = %+v", orders)
	}
	if orders[0].Operation != catalog.TableOperationRead || orders[0].Method != "Postgres.ByID" {
		t.Errorf("first orders access = %+v", orders[0])
	}
	if orders[1].Operation != catalog.TableOperationRead || orders[1].Method != "Postgres.WithLines" {
		t.Errorf("second orders access = %+v", orders[1])
	}
	if orders[2].Operation != catalog.TableOperationWrite || orders[2].Method != "Postgres.Save" {
		t.Errorf("orders writer = %+v", orders[2])
	}
	for _, access := range orders {
		if !strings.Contains(access.Source, "/internal/order/infrastructure/repository/postgres.go:") {
			t.Errorf("source = %q", access.Source)
		}
	}

	lines := byName["order_lines"].Accesses
	if len(lines) != 3 || lines[0].Method != "Postgres.WithLines" || lines[1].Operation != catalog.TableOperationWrite || lines[2].Operation != catalog.TableOperationDelete {
		t.Errorf("order_lines accesses = %+v", lines)
	}
}

func nilBuilder() *plugin.Builder { return &plugin.Builder{} }
