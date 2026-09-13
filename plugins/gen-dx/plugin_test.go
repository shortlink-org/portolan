package gendx

import (
	"encoding/json"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"github.com/shortlink-org/portolan/plugin/schematest"
)

func TestOptionsSchema(t *testing.T) { schematest.Check(t, optionsSchema, Options{}) }

func TestRenderPlan(t *testing.T) {
	cat := catalog.Catalog{Contexts: []catalog.BoundedContext{{
		ID: "shop", Name: "Shop", Services: []catalog.Service{
			{ID: "shop.cart", Name: "Cart", Repo: "github.com/acme/shop", Readme: "# Cart\n\nOwns baskets.", Owners: []string{"@acme/cart"}, Technologies: []string{"Go"}, DependsOn: []string{"shop.pricing"}},
			{ID: "shop.pricing", Name: "Pricing", Repo: "https://github.com/acme/shop.git", Readme: "Prices."},
		},
	}}}
	resp, err := render(plugin.Request{Catalog: cat}, Options{TechnologyProperty: "language", OwnerTeamIDs: map[string]string{"@acme/cart": "team-1"}})
	if err != nil {
		t.Fatal(err)
	}
	var plan Plan
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Entities) != 2 || plan.Entities[0].Identifier != "shop.cart" {
		t.Fatalf("entities = %+v", plan.Entities)
	}
	if plan.Entities[0].Aliases["github_repo"][0].Lookup != "acme/shop" {
		t.Fatalf("aliases = %+v", plan.Entities[0].Aliases)
	}
	if len(plan.Entities[0].OwnerTeamIDs) != 1 || plan.Entities[0].OwnerTeamIDs[0] != "team-1" {
		t.Fatalf("owners = %+v", plan.Entities[0].OwnerTeamIDs)
	}
	if len(plan.RelationEdges) != 1 || plan.RelationEdges[0].Edges["shop.cart"][0] != "shop.pricing" {
		t.Fatalf("edges = %+v", plan.RelationEdges)
	}
}

func TestRenderIsStable(t *testing.T) {
	left := catalog.Catalog{Contexts: []catalog.BoundedContext{{ID: "z", Services: []catalog.Service{{ID: "z.b", Name: "B"}, {ID: "z.a", Name: "A"}}}}}
	right := catalog.Catalog{Contexts: []catalog.BoundedContext{{ID: "z", Services: []catalog.Service{{ID: "z.a", Name: "A"}, {ID: "z.b", Name: "B"}}}}}
	a, _ := render(plugin.Request{Catalog: left}, Options{})
	b, _ := render(plugin.Request{Catalog: right}, Options{})
	if a.Files[0].Contents != b.Files[0].Contents {
		t.Fatal("plan depends on catalog order")
	}
}
