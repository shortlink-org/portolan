package genreference

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"github.com/shortlink-org/portolan/plugin/schematest"
)

func TestOptionsSchema(t *testing.T) { schematest.Check(t, optionsSchema, Options{}) }

func TestRenderProducesOneSelfContainedReference(t *testing.T) {
	cat := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{ID: "shop", Slug: "shop", Name: "Shop", Summary: "Takes orders.", Services: []catalog.Service{{
			ID: "shop.orders", Slug: "orders", Name: "Orders", Readme: "Owns the order lifecycle.", Technologies: []string{"Go"},
			Aggregates: []catalog.Aggregate{{ID: "shop.orders.order", Slug: "order", Name: "Order", Events: []catalog.Event{{ID: "shop.orders.order.placed", Slug: "placed", Name: "Order placed", Consumers: []catalog.EventConsumer{{Service: "delivery", Status: catalog.StatusDeclared}}}}}},
		}}}},
		Flows: []catalog.Flow{{ID: "checkout", Slug: "checkout", Name: "Checkout", Summary: "Places an order.", Owner: "shop"}},
	}
	resp, err := render(plugin.Request{Catalog: cat}, Options{Title: "Example estate", Summary: "A reference for reviewers."})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Files) != 1 || resp.Files[0].Name != outputName {
		t.Fatalf("unexpected files: %+v", resp.Files)
	}
	html := resp.Files[0].Contents
	for _, want := range []string{"<!doctype html>", "Example estate", "Order placed", "delivery", "Complete merged catalog JSON", "Search name, ID or summary"} {
		if !strings.Contains(html, want) {
			t.Errorf("reference does not contain %q", want)
		}
	}
	for _, external := range []string{"<script src=", "<link rel=\"stylesheet\"", "url(http"} {
		if strings.Contains(html, external) {
			t.Errorf("reference has an external dependency %q", external)
		}
	}
	if strings.Index(html, `"kind":"context"`) > strings.Index(html, `"kind":"flow"`) {
		t.Fatal("the reference does not lead from the estate to its flows")
	}
}

func TestReferenceIsStableAcrossCatalogOrder(t *testing.T) {
	a := catalog.BoundedContext{ID: "a", Slug: "a", Name: "A", Services: []catalog.Service{}}
	z := catalog.BoundedContext{ID: "z", Slug: "z", Name: "Z", Services: []catalog.Service{}}
	first, err := render(plugin.Request{Catalog: catalog.Catalog{Contexts: []catalog.BoundedContext{z, a}, Flows: []catalog.Flow{{ID: "z"}, {ID: "a"}}}}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := render(plugin.Request{Catalog: catalog.Catalog{Contexts: []catalog.BoundedContext{a, z}, Flows: []catalog.Flow{{ID: "a"}, {ID: "z"}}}}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if first.Files[0].Contents != second.Files[0].Contents {
		t.Fatal("the same catalog in another order produced another reference")
	}
}

func TestEmbeddedJSONCannotCloseItsScript(t *testing.T) {
	resp, err := render(plugin.Request{Catalog: catalog.Catalog{Contexts: []catalog.BoundedContext{{ID: "x", Name: "</script><script>alert(1)</script>"}}}}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	html := resp.Files[0].Contents
	if strings.Count(html, "</script>") != 2 {
		t.Fatalf("catalog text escaped the JSON script: %s", html)
	}
	var decoded map[string]any
	start := strings.Index(html, `<script id="portolan-reference" type="application/json">`) + len(`<script id="portolan-reference" type="application/json">`)
	end := strings.Index(html[start:], "</script>") + start
	if err := json.Unmarshal([]byte(html[start:end]), &decoded); err != nil {
		t.Fatalf("embedded payload is not JSON: %v", err)
	}
}
