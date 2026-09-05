package main

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"github.com/shortlink-org/portolan/plugin/schematest"
	"gopkg.in/yaml.v3"
)

func TestOptionsSchema(t *testing.T) { schematest.Check(t, optionsSchema, Options{}) }

func TestRenderBackstageRelationships(t *testing.T) {
	cat := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID: "shop", Name: "Shop",
			Services: []catalog.Service{{
				ID: "shop.cart", Name: "Cart", Repo: "github.com/acme/shop", Path: "services/cart",
				Owners: []string{"@team-cart"}, Stores: []string{"shop.cart.pg"},
				Provides: []catalog.RpcService{{
					ID: "shop.v1.Cart", Source: "api.yaml",
					Methods: []catalog.RpcMethod{{Name: "Get", HTTP: &catalog.HttpRoute{Method: "GET", Path: "/cart"}}},
				}},
			}},
		}},
		Stores: []catalog.Store{{ID: "shop.cart.pg", Name: "Cart DB", Kind: catalog.StoreKindPostgres, Owner: "shop.cart"}},
	}
	resp, err := render(plugin.Request{Catalog: cat}, Options{SourceBaseURL: "https://github.com/acme/shop/blob/main"})
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(resp.Files[0].Contents, "\n---\n")
	if len(parts) != 5 {
		t.Fatalf("got %d entities\n%s", len(parts), resp.Files[0].Contents)
	}
	for _, part := range parts {
		var value map[string]any
		if err := yaml.Unmarshal([]byte(part), &value); err != nil {
			t.Fatal(err)
		}
	}
	if !strings.Contains(resp.Files[0].Contents, "providesApis:") || !strings.Contains(resp.Files[0].Contents, "team-cart") {
		t.Fatal(resp.Files[0].Contents)
	}
	if !strings.Contains(resp.Files[0].Contents, "url:https://github.com/acme/shop/blob/main/services/cart/api.yaml") {
		t.Fatal(resp.Files[0].Contents)
	}
}

func TestNameIsBackstageSafe(t *testing.T) {
	if got := nameOf("buf.build/Acme/Very Long API"); got != "buf-build-acme-very-long-api" {
		t.Fatalf("%q", got)
	}
}

func TestNameIsASCII(t *testing.T) {
	if got := nameOf("Оплата.API"); got != "api" {
		t.Fatalf("%q", got)
	}
}

func TestSourceDirectoryDetection(t *testing.T) {
	if !sourceIsDirectory("services/cart/repository") || sourceIsDirectory("services/cart/api.yaml:12") {
		t.Fatal("source directory detection drifted")
	}
}

func TestRenderRejectsDanglingBackstageReferences(t *testing.T) {
	cat := catalog.Catalog{Contexts: []catalog.BoundedContext{{
		ID: "shop", Name: "Shop", Services: []catalog.Service{{
			ID: "shop.cart", Name: "Cart", Stores: []string{"missing.store"},
		}},
	}}}
	_, err := render(plugin.Request{Catalog: cat}, Options{})
	if err == nil || !strings.Contains(err.Error(), "unresolved dependsOn") {
		t.Fatalf("expected unresolved reference, got %v", err)
	}
}
