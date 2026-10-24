package genmarkdown

import (
	"encoding/json"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestAgentBundleCarriesTheCanonicalCatalogAndPageIndex(t *testing.T) {
	cat := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID:   "shop",
			Slug: "shop",
			Name: "Shop",
			Services: []catalog.Service{{
				ID: "shop.oms", Slug: "oms", Name: "Order management",
			}},
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{},
		Adrs:  []catalog.Adr{},
	}

	files := renderedFiles(render(plugin.Request{Catalog: cat}, Options{Title: "Shop estate"}))
	raw, ok := files["agent.json"]
	if !ok {
		t.Fatal("markdown generation did not produce agent.json")
	}

	var bundle struct {
		Version int               `json:"version"`
		Title   string            `json:"title"`
		Catalog catalog.Catalog   `json:"catalog"`
		Pages   map[string]string `json:"pages"`
	}
	if err := json.Unmarshal([]byte(raw), &bundle); err != nil {
		t.Fatalf("agent.json is not valid JSON: %v", err)
	}
	if bundle.Version != 1 || bundle.Title != "Shop estate" {
		t.Fatalf("unexpected bundle identity: version=%d title=%q", bundle.Version, bundle.Title)
	}
	if len(bundle.Catalog.Contexts) != 1 || bundle.Catalog.Contexts[0].Services[0].ID != "shop.oms" {
		t.Fatalf("bundle does not carry the canonical catalog: %#v", bundle.Catalog.Contexts)
	}
	if bundle.Pages["shop"] != "shop/README.md" || bundle.Pages["shop.oms"] != "shop/oms/README.md" {
		t.Fatalf("bundle page index = %#v", bundle.Pages)
	}
}
