package extractproto

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

func externalOptions() Options {
	return Options{
		External:        "pricing",
		ExternalName:    "Pricing",
		ExternalSummary: "Quotes a price.",
		ExternalURL:     "https://pricing.example/docs",
		Paths:           []string{"internal/infrastructure/pricing"},
		Out:             "pricing.json",
	}
}

// A copy vendored beside the adapter that calls a system outside the estate
// describes that system and nothing else: the fragment carries the external,
// with the interfaces the copy declares, and no context, service or module.
func TestExternalCopyDescribesTheExternal(t *testing.T) {
	resp, err := extract(input(), externalOptions())
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Files) != 1 || resp.Files[0].Name != "pricing.json" {
		t.Fatalf("files: %+v", resp.Files)
	}

	var frag catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &frag); err != nil {
		t.Fatal(err)
	}
	if len(frag.Contexts) != 0 || len(frag.Modules) != 0 || len(frag.Defs) != 0 {
		t.Errorf("an external fragment claimed a context, a module or a def: %+v", frag)
	}
	if len(frag.Externals) != 1 {
		t.Fatalf("externals: %+v", frag.Externals)
	}

	ext := frag.Externals[0]
	if ext.ID != "pricing" || ext.Slug != "pricing" || ext.Name != "Pricing" || ext.Summary != "Quotes a price." || ext.URL != "https://pricing.example/docs" {
		t.Errorf("identity: %+v", ext)
	}
	if len(ext.Provides) != 1 || ext.Provides[0].ID != "pricing.v1.Pricing" {
		t.Fatalf("provides: %+v", ext.Provides)
	}
	if ext.Provides[0].Module != "" {
		t.Errorf("a vendored excerpt names a module: %q", ext.Provides[0].Module)
	}

	var names []string
	for _, m := range ext.Provides[0].Methods {
		names = append(names, m.Name)
	}
	if strings.Join(names, ",") != "GetQuote,WatchPrices" {
		t.Errorf("methods: %v", names)
	}
}

// An external sits at the root of the catalog and is addressed by a bare name.
func TestExternalIDMustBeBare(t *testing.T) {
	opts := externalOptions()
	opts.External = "acme.pricing"

	if _, err := extract(input(), opts); err == nil {
		t.Error("a dotted external id was accepted")
	}
}
