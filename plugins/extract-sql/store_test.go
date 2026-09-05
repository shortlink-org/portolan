package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func fragment(t *testing.T) (catalog.Catalog, []plugin.Warning) {
	t.Helper()

	resp := extract(
		plugin.Input{Root: "../../examples/auth", Commit: "abc1234", GeneratedAt: "2026-01-01T00:00:00Z"},
		Options{Context: "auth", Service: "auth", Store: "pg", Name: "Auth database"},
	)
	if len(resp.Files) != 1 {
		t.Fatalf("expected one fragment, got %d files", len(resp.Files))
	}

	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}

	return out, resp.Warnings()
}

// One store, not one per aggregate: the migrations are numbered inside their
// own package but they are all applied to the same database.
func TestOneStoreHoldsEveryAggregatesTables(t *testing.T) {
	cat, _ := fragment(t)

	if len(cat.Stores) != 1 {
		t.Fatalf("expected one store, got %d", len(cat.Stores))
	}

	store := cat.Stores[0]
	if store.ID != "auth.auth.pg" || store.Owner != "auth.auth" {
		t.Errorf("store = %s owned by %s", store.ID, store.Owner)
	}

	persists := map[string]string{}
	for _, table := range store.Tables {
		persists[table.Name] = table.Persists.Aggregate
	}
	if persists["users"] != "auth.auth.user" || persists["sessions"] != "auth.auth.session" {
		t.Errorf("tables are linked to the wrong aggregates: %v", persists)
	}
}

// The service half of the fragment says only which store it touches. What it
// is called and what it holds belong to the extractors that read those.
func TestFragmentClaimsOnlyTheLink(t *testing.T) {
	cat, _ := fragment(t)

	service := cat.Contexts[0].Services[0]
	if len(service.Stores) != 1 || service.Stores[0] != "auth.auth.pg" {
		t.Errorf("stores = %v", service.Stores)
	}
	if service.Name != "" || service.Readme != "" || len(service.Aggregates) != 0 {
		t.Errorf("the sql fragment should not describe the service: %+v", service)
	}
}

// A table brought by a dependency is real, and its DDL is not here. Silence
// would read as "there is no such table".
func TestSchemaAppliedFromOutsideTheTreeIsReported(t *testing.T) {
	_, diagnostics := fragment(t)

	var found string
	for _, d := range diagnostics {
		if strings.Contains(d.Message, "not in this tree") {
			found = d.Message
		}
	}

	if !strings.Contains(found, "go-sdk/outbox") {
		t.Errorf("the outbox schema should be reported by import path, got %q", found)
	}
	// The repository packages next door are imported under aliases that look
	// just as foreign as the SDK's. Only the path tells them apart.
	for _, d := range diagnostics {
		if strings.Contains(d.Message, "repo") && strings.Contains(d.Message, "not in this tree") {
			t.Errorf("a package from this module was called foreign: %q", d.Message)
		}
	}
}

// writeTree lays out a service under a temporary root: one file per path.
func writeTree(t *testing.T, files map[string]string) string {
	t.Helper()

	root := t.TempDir()
	for rel, contents := range files {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	return root
}

// A projector package is the layout's word for a projection: every table it
// creates has that role. Whose rows it pictures is not in the layout, so it is
// taken from the migration when written there and left out when not - a
// projection of another service's aggregate has no directory here to be named
// by. The repository packages beside it are read exactly as before.
func TestProjectorPackagesAreProjections(t *testing.T) {
	root := writeTree(t, map[string]string{
		"internal/infrastructure/repository/route/migrations/0001_routes.sql": `
CREATE TABLE routes (
    id      text PRIMARY KEY,
    version bigint NOT NULL
);
CREATE TABLE route_legs (
    route_id text NOT NULL REFERENCES routes (id),
    seq      integer NOT NULL
);`,
		"internal/infrastructure/projector/route_board/migrations/0001_route_board.sql": `
-- Stops with the address to print, rebuilt from OrderPlaced.
-- aggregate: shop.oms.order
CREATE TABLE route_board (
    order_id     text PRIMARY KEY,
    -- from: shop.oms.pg.orders.ship_to
    address      text NOT NULL,
    projected_at timestamptz NOT NULL
);

CREATE TABLE route_board_cursor (
    topic    text PRIMARY KEY,
    -- from: routes.version
    position bigint NOT NULL
);`,
	})

	resp := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "delivery"})
	if len(resp.Files) != 1 {
		t.Fatalf("expected one fragment, got %d files", len(resp.Files))
	}
	var cat catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &cat); err != nil {
		t.Fatal(err)
	}
	if len(cat.Stores) != 1 {
		t.Fatalf("expected one store, got %d", len(cat.Stores))
	}

	byName := map[string]catalog.Table{}
	for _, table := range cat.Stores[0].Tables {
		byName[table.Name] = table
	}
	if len(byName) != 4 {
		t.Fatalf("expected four tables, got %v", byName)
	}

	// The repository side is unchanged.
	if byName["routes"].Role != catalog.TableRoleAggregateRoot || byName["routes"].Persists.Aggregate != "shop.delivery.route" {
		t.Errorf("routes = %+v", byName["routes"])
	}
	if byName["route_legs"].Role != catalog.TableRoleChild || byName["route_legs"].Persists.Aggregate != "shop.delivery.route" {
		t.Errorf("route_legs = %+v", byName["route_legs"])
	}

	board := byName["route_board"]
	if board.ID != "shop.delivery.pg.route_board" || board.Role != catalog.TableRoleProjection {
		t.Errorf("route_board = %+v", board)
	}
	if board.Persists == nil || board.Persists.Aggregate != "shop.oms.order" {
		t.Errorf("the migration says whose picture this is: %+v", board.Persists)
	}
	for _, column := range board.Columns {
		if column.Name != "address" {
			continue
		}
		if len(column.From) != 1 || column.From[0] != "shop.oms.pg.orders.ship_to" {
			t.Errorf("address.from = %v", column.From)
		}
		if column.Maps != "" {
			t.Errorf("a projection column maps to no aggregate field, got %q", column.Maps)
		}
	}

	cursor := byName["route_board_cursor"]
	if cursor.Role != catalog.TableRoleProjection {
		t.Errorf("every table a projector creates is a projection, got %q", cursor.Role)
	}
	if cursor.Persists != nil {
		t.Errorf("no note, no link: %+v", cursor.Persists)
	}
	for _, column := range cursor.Columns {
		if column.Name == "position" && (len(column.From) != 1 || column.From[0] != "shop.delivery.pg.routes.version") {
			t.Errorf("a copy inside the store gets the store put back on, got %v", column.From)
		}
	}

	for _, d := range resp.Warnings() {
		if strings.Contains(d.Message, "no migrations") {
			t.Errorf("the store has tables, yet: %q", d.Message)
		}
	}
}

// A service with projectors and no repositories still keeps state.
func TestAStoreOfOnlyProjectionsIsStillAStore(t *testing.T) {
	root := writeTree(t, map[string]string{
		"internal/infrastructure/projector/user_directory/migrations/0001_user_directory.sql": `
CREATE TABLE user_directory (
    user_id text PRIMARY KEY,
    email   text NOT NULL
);`,
	})

	resp := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "bff"})
	var cat catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &cat); err != nil {
		t.Fatal(err)
	}
	if len(cat.Stores) != 1 || len(cat.Stores[0].Tables) != 1 || cat.Stores[0].Tables[0].Role != catalog.TableRoleProjection {
		t.Errorf("stores = %+v", cat.Stores)
	}
}
