package main

// The id rules, which are the join between fragments that never see each other.

import "testing"

func TestModuleIdentity(t *testing.T) {
	cases := []struct{ id, name, slug, registry string }{
		{"buf.build/acme/shop", "acme/shop", "acme-shop", "buf.build"},
		{"buf.build/acme/shop-events", "acme/shop-events", "acme-shop-events", "buf.build"},
		// A local id is a path, not `host/owner/name`. Trimming its first
		// segment would name a directory that does not exist.
		{"local:internal/infrastructure/pricing", "internal/infrastructure/pricing", "internal-infrastructure-pricing", ""},
		{"local:proto", "proto", "proto", ""},
	}

	for _, c := range cases {
		if got := moduleName(c.id); got != c.name {
			t.Errorf("%s name: %q, want %q", c.id, got, c.name)
		}
		if got := moduleSlug(c.id); got != c.slug {
			t.Errorf("%s slug: %q, want %q", c.id, got, c.slug)
		}
		if got := registryOf(c.id); got != c.registry {
			t.Errorf("%s registry: %q, want %q", c.id, got, c.registry)
		}
	}
}

// A slug goes in a URL segment, so it may never carry a dot or a slash -
// src/routes.test.ts holds every catalog path to that.
func TestSlugIsUrlSafe(t *testing.T) {
	for _, id := range []string{"buf.build/acme/shop.v1", "local:proto/shop/v1"} {
		slug := moduleSlug(id)
		for _, bad := range []rune{'.', '/', ':', ' '} {
			for _, r := range slug {
				if r == bad {
					t.Errorf("%s gives slug %q, which cannot go in a URL segment", id, slug)
				}
			}
		}
	}
}

// The ids the catalog joins on, spelled the way data/catalog.json spells them.
func TestInterfaceAndCallIds(t *testing.T) {
	if got := interfaceID("shop.v1", "Orders"); got != "shop.v1.Orders" {
		t.Errorf("interface id: %q", got)
	}
	if got := callID("shop.v1.Orders", "PlaceOrder"); got != "shop.v1.Orders/PlaceOrder" {
		t.Errorf("call id: %q", got)
	}
	// A proto with no package still has to produce something findable.
	if got := interfaceID("", "Orders"); got != "Orders" {
		t.Errorf("interface id with no package: %q", got)
	}
}
