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

// An estate of two services in two contexts, which is enough for every rule
// this has: one owned, one not, one rule that owns nothing.
func estate() catalog.Catalog {
	return catalog.Catalog{
		Contexts: []catalog.BoundedContext{
			{
				ID:   "shop",
				Slug: "shop",
				Services: []catalog.Service{
					{ID: "shop.oms", Slug: "oms", Name: "OMS", Path: "examples/shop/oms"},
					{ID: "shop.cart", Slug: "cart", Name: "Cart", Path: "examples/shop/cart"},
				},
			},
			{
				ID:   "auth",
				Slug: "auth",
				Services: []catalog.Service{
					{ID: "auth.auth", Slug: "auth", Name: "Auth", Path: "examples/auth"},
				},
			},
		},
	}
}

func request(t *testing.T, codeowners string) plugin.Request {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".github"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".github", "CODEOWNERS"), []byte(codeowners), 0o644); err != nil {
		t.Fatal(err)
	}

	return plugin.Request{
		Input:   plugin.Input{Root: root, Commit: "abc1234", GeneratedAt: "2026-01-01T00:00:00Z"},
		Catalog: estate(),
	}
}

func fragmentOf(t *testing.T, resp plugin.Response) catalog.Catalog {
	t.Helper()
	if len(resp.Files) != 1 {
		t.Fatalf("files = %d, want one fragment", len(resp.Files))
	}
	var parsed catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &parsed); err != nil {
		t.Fatalf("fragment is not a catalog: %v", err)
	}

	return parsed
}

func ownersOf(c catalog.Catalog, id string) []string {
	for _, context := range c.Contexts {
		for _, service := range context.Services {
			if service.ID == id {
				return service.Owners
			}
		}
	}

	return nil
}

// The rule that decides every answer: the file is read top to bottom and the
// LAST rule that matches wins, which is what lets a broad rule at the top be
// narrowed underneath.
func TestTheLastMatchingRuleWins(t *testing.T) {
	resp, err := verify(request(t, `
*                  @acme/platform
examples/shop      @acme/shop-team
examples/shop/oms  @acme/oms-team
`), Options{})
	if err != nil {
		t.Fatal(err)
	}

	fragment := fragmentOf(t, resp)
	if got := ownersOf(fragment, "shop.oms"); len(got) != 1 || got[0] != "@acme/oms-team" {
		t.Errorf("shop.oms owners = %v, want the narrowest rule's", got)
	}
	if got := ownersOf(fragment, "shop.cart"); len(got) != 1 || got[0] != "@acme/shop-team" {
		t.Errorf("shop.cart owners = %v", got)
	}
	if got := ownersOf(fragment, "auth.auth"); len(got) != 1 || got[0] != "@acme/platform" {
		t.Errorf("auth.auth owners = %v, want the catch-all", got)
	}
}

// A pattern that matches and names nobody is how a forge takes ownership back.
// It has to win, or the rule it was written to cancel keeps applying.
func TestARuleNamingNobodyTakesOwnershipBack(t *testing.T) {
	resp, err := verify(request(t, "*  @acme/platform\nexamples/shop/oms\n"), Options{})
	if err != nil {
		t.Fatal(err)
	}

	if got := ownersOf(fragmentOf(t, resp), "shop.oms"); len(got) != 0 {
		t.Errorf("shop.oms owners = %v, want nobody", got)
	}
	if !warned(resp, "shop.oms", "owned by nobody") {
		t.Errorf("diagnostics = %+v, want the one saying nobody owns it", resp.Warnings())
	}
}

// The half that earns the name: a rule matching no service is a team that
// believes it owns something the estate does not have, which is the failure a
// CODEOWNERS file has and can never report about itself.
func TestARuleThatOwnsNothingIsReported(t *testing.T) {
	resp, err := verify(request(t, "*  @acme/platform\nservices/billing  @acme/billing\n"), Options{})
	if err != nil {
		t.Fatal(err)
	}

	if !warned(resp, "CODEOWNERS:2", "matches no service") {
		t.Errorf("diagnostics = %+v, want the one about the unused rule", resp.Warnings())
	}
}

// The other way a rule can be dead, and a different fix: it matches, it just
// never wins, because everything it covers is claimed further down. Saying
// "matches no service" about a catch-all would be false and would teach a
// reader to ignore the warning that is true.
func TestARuleAlwaysOverriddenIsReportedAsSuch(t *testing.T) {
	resp, err := verify(request(t, "*  @acme/platform\nexamples  @acme/estate\n"), Options{})
	if err != nil {
		t.Fatal(err)
	}

	if !warned(resp, "CODEOWNERS:1", "claimed by a rule below it") {
		t.Errorf("diagnostics = %+v, want the one about the overridden catch-all", resp.Warnings())
	}
	if warned(resp, "CODEOWNERS:1", "matches no service") {
		t.Error("the catch-all matches every service; it just never wins")
	}
}

func TestSectionsAreReadFlatAndSaidSoOutLoud(t *testing.T) {
	resp, err := verify(request(t, "[Backend]\n*  @acme/platform\n"), Options{})
	if err != nil {
		t.Fatal(err)
	}

	if !warned(resp, "CODEOWNERS", "section headers") {
		t.Errorf("diagnostics = %+v, want the one about sections", resp.Warnings())
	}
	if got := ownersOf(fragmentOf(t, resp), "shop.oms"); len(got) != 1 {
		t.Errorf("owners = %v; the rules under a section are still read", got)
	}
}

// Determinism, the second obligation: the same catalog and the same file
// produce the same bytes, or `gen:check` reports drift on a run that changed
// nothing.
func TestTheFragmentIsStable(t *testing.T) {
	req := request(t, "*  @acme/platform\nexamples/shop/oms  @acme/oms-team @someone\n")

	first, err := verify(req, Options{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := verify(req, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if first.Files[0].Contents != second.Files[0].Contents {
		t.Error("two runs wrote different bytes")
	}
	// Named in the order the rule names them: a file that lists the team
	// before the person is showing an order somebody chose.
	if got := ownersOf(fragmentOf(t, first), "shop.oms"); strings.Join(got, " ") != "@acme/oms-team @someone" {
		t.Errorf("owners = %v, want the file's order", got)
	}
}

// A path in the manifest that is not there is a typo, and answering "nobody
// owns anything" to a typo is only noticed a month later.
func TestANamedFileThatIsNotThereFailsTheRun(t *testing.T) {
	if _, err := verify(request(t, "* @acme/platform\n"), Options{File: "OWNERS"}); err == nil {
		t.Fatal("a missing file was accepted")
	}
}

func TestTheFragmentCarriesTheHostsStamp(t *testing.T) {
	resp, err := verify(request(t, "* @acme/platform\n"), Options{})
	if err != nil {
		t.Fatal(err)
	}

	fragment := fragmentOf(t, resp)
	if fragment.Commit != "abc1234" || fragment.GeneratedAt != "2026-01-01T00:00:00Z" {
		t.Errorf("stamp = %q %q", fragment.Commit, fragment.GeneratedAt)
	}
	// A context in the fragment is a shell the merge fills in, and its slug
	// has to equal its id or the validator refuses the union.
	for _, context := range fragment.Contexts {
		if context.Slug != context.ID {
			t.Errorf("context %q has slug %q", context.ID, context.Slug)
		}
	}
}

func warned(resp plugin.Response, ref, contains string) bool {
	for _, w := range resp.Warnings() {
		if strings.Contains(w.Ref, ref) && strings.Contains(w.Message, contains) {
			return true
		}
	}

	return false
}
