package genmarkdown

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestRendersPostgresTableReadersAndWriters(t *testing.T) {
	cat := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID: "sales", Slug: "sales", Name: "Sales", Services: []catalog.Service{{
				ID: "sales.catalog", Slug: "catalog", Name: "Catalog", Provides: []catalog.RpcService{}, Consumes: []catalog.RpcCall{}, Aggregates: []catalog.Aggregate{}, Stores: []string{"sales.catalog.pg"},
			}},
		}},
		Defs: map[string]catalog.TypeDef{}, Flows: []catalog.Flow{}, Adrs: []catalog.Adr{},
		Stores: []catalog.Store{{
			ID: "sales.catalog.pg", Slug: "pg", Name: "Catalog Postgres", Kind: catalog.StoreKindPostgres, Owner: "sales.catalog",
			Tables: []catalog.Table{{
				ID: "sales.catalog.pg.products", Name: "products", Columns: []catalog.Column{},
				Accesses: []catalog.TableAccess{
					{Operation: catalog.TableOperationRead, Method: "Postgres.ByID", Source: "postgres.go:40"},
					{Operation: catalog.TableOperationWrite, Method: "Postgres.Save", Source: "postgres.go:20"},
				},
			}},
		}},
	}

	response := render(plugin.Request{Catalog: cat}, Options{})
	var page string
	for _, file := range response.Files {
		if file.Name == "sales/catalog/stores/pg.md" {
			page = file.Contents
			break
		}
	}
	for _, want := range []string{"| Access | Method | Source |", "read", "`Postgres.ByID`", "write", "`Postgres.Save`", "postgres.go"} {
		if !strings.Contains(page, want) {
			t.Fatalf("Postgres store page does not contain %q:\n%s", want, page)
		}
	}
}
