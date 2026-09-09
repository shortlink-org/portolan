package genmarkdown

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestRendersRedisKeyPatterns(t *testing.T) {
	cat := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID: "sales", Slug: "sales", Name: "Sales", Services: []catalog.Service{{
				ID: "sales.catalog", Slug: "catalog", Name: "Catalog", Provides: []catalog.RpcService{}, Consumes: []catalog.RpcCall{}, Aggregates: []catalog.Aggregate{{
					ID: "sales.catalog.session", Slug: "session", Name: "Session", Root: "Session", Entities: []catalog.Block{}, ValueObjects: []catalog.Block{}, Operations: []catalog.Operation{}, Events: []catalog.Event{},
				}}, Stores: []string{"sales.catalog.redis"},
			}},
		}},
		Defs: map[string]catalog.TypeDef{}, Flows: []catalog.Flow{}, Adrs: []catalog.Adr{},
		Stores: []catalog.Store{{
			ID: "sales.catalog.redis", Slug: "redis", Name: "Catalog Redis", Kind: catalog.StoreKindRedis, Owner: "sales.catalog", Tables: []catalog.Table{},
			Keyspaces: []catalog.RedisKeyspace{{
				Pattern: "session:{id}", Operations: []catalog.RedisOperation{catalog.RedisOperationRead, catalog.RedisOperationWrite}, TTL: "24h", Value: "Session", Source: "cache.go:20",
				Persists: &catalog.Persists{Aggregate: "sales.catalog.session"},
				Accesses: []catalog.RedisAccess{{Operation: catalog.RedisOperationRead, Method: "Store.Get", Value: "Session", Source: "cache.go:20"}, {Operation: catalog.RedisOperationWrite, Method: "Store.Save", TTL: "24h", Value: "Session", Source: "cache.go:30"}},
			}},
		}},
	}

	response := render(plugin.Request{Catalog: cat}, Options{})
	var page string
	for _, file := range response.Files {
		if file.Name == "sales/catalog/stores/redis.md" {
			page = file.Contents
			break
		}
	}
	for _, want := range []string{"## Redis key patterns", "## Redis accesses", "`session:{id}`", "read, write", "`Session`", "`24h`", "sales.catalog.session", "`Store.Get`", "`Store.Save`", "cache.go"} {
		if !strings.Contains(page, want) {
			t.Fatalf("Redis store page does not contain %q:\n%s", want, page)
		}
	}
}
