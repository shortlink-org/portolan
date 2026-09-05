package main

import (
	"encoding/json"
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
