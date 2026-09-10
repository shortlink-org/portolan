package genmarkdown

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestModelGroupNeedsNoRoot(t *testing.T) {
	cat := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{ID: "shop", Slug: "shop", Services: []catalog.Service{{
			ID: "shop.billing", Slug: "billing", Aggregates: []catalog.Aggregate{{
				ID: "shop.billing.models-ledger", Slug: "models-ledger", Name: "ledger", Kind: "model-group",
				Entities: []catalog.Block{{ID: "shop.billing.models-ledger.entry", Slug: "entry", Name: "Entry", Fields: []catalog.Field{{Name: "id", Type: "int"}}}},
			}},
		}}}},
	}
	result := render(plugin.Request{Catalog: cat}, Options{})
	found := false
	for _, file := range result.Files {
		if strings.HasSuffix(file.Name, "/aggregates/models-ledger.md") {
			found = true
			if !strings.Contains(file.Contents, "not specified (model group)") || !strings.Contains(file.Contents, "Entry") {
				t.Fatalf("missing model group content: %s", file.Contents)
			}
		}
	}
	if !found {
		t.Fatal("model group page not generated")
	}
	// Rootless groups are intentional and must not create replacement warnings.
	for _, warning := range result.Warnings() {
		if strings.Contains(warning.Message, "root") {
			t.Fatal(warning.Message)
		}
	}
}
