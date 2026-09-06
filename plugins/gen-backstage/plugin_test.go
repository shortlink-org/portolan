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

func TestComponentCarriesItsCommands(t *testing.T) {
	cat := catalog.Catalog{Contexts: []catalog.BoundedContext{{
		ID: "shop", Name: "Shop", Services: []catalog.Service{{
			ID: "shop.pricing", Name: "Pricing", Repo: "github.com/acme/shop", Path: "services/pricing",
			Commands: []catalog.Command{
				{Runner: "make", Name: "gen", Run: "make gen", Doc: "Regenerate the stubs", Body: "buf generate", Source: "services/pricing/Makefile:6"},
				{Runner: "make", Name: "test", Run: "make test", Source: "services/pricing/Makefile:15"},
			},
		}},
	}}}
	resp, err := render(plugin.Request{Catalog: cat}, Options{SourceBaseURL: "https://github.com/acme/shop/blob/main"})
	if err != nil {
		t.Fatal(err)
	}
	var component struct {
		Metadata struct {
			Annotations map[string]string
			Links       []struct{ URL, Title, Type string }
		}
	}
	var part string
	for _, candidate := range strings.Split(resp.Files[0].Contents, "\n---\n") {
		if strings.Contains(candidate, "kind: Component") {
			part = candidate
		}
	}
	if err := yaml.Unmarshal([]byte(part), &component); err != nil {
		t.Fatal(err)
	}
	if got := component.Metadata.Annotations["portolan.io/commands"]; got != "make gen — Regenerate the stubs\nmake test" {
		t.Errorf("annotation = %q", got)
	}
	if len(component.Metadata.Links) != 2 || component.Metadata.Links[0].URL != "https://github.com/acme/shop/blob/main/services/pricing/Makefile#L6" || component.Metadata.Links[0].Title != "make gen — Regenerate the stubs" || component.Metadata.Links[0].Type != "command" {
		t.Errorf("links = %+v", component.Metadata.Links)
	}

	// Without a source base there is nowhere to link to; the list still
	// travels in the annotation.
	resp, err = render(plugin.Request{Catalog: cat}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(resp.Files[0].Contents, "links:") || !strings.Contains(resp.Files[0].Contents, "portolan.io/commands") {
		t.Fatal(resp.Files[0].Contents)
	}
}

func TestNameIsBackstageSafe(t *testing.T) {
	if got := nameOf("buf.build/Acme/Very Long API"); got != "buf-build-acme-very-long-api" {
		t.Fatalf("%q", got)
	}
}

func TestNeutralComponentKindBecomesBackstageType(t *testing.T) {
	cat := catalog.Catalog{Contexts: []catalog.BoundedContext{{
		ID: "tools", Name: "Tools", Kind: catalog.GroupKindSystem, Services: []catalog.Service{{
			ID: "tools.cli", Name: "CLI", Kind: catalog.ComponentKindCLI, Technologies: []string{"OpenTelemetry", "Go"},
		}},
	}}}
	resp, err := render(plugin.Request{Catalog: cat}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(resp.Files[0].Contents, "type: tool") {
		t.Fatal(resp.Files[0].Contents)
	}
	if !strings.Contains(resp.Files[0].Contents, "- go") || !strings.Contains(resp.Files[0].Contents, "- opentelemetry") {
		t.Fatal(resp.Files[0].Contents)
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
