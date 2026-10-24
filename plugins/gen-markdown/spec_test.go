package genmarkdown

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestSpecificationsRenderIntentAndChecklistWithoutClaimingConformance(t *testing.T) {
	cat := catalog.Catalog{Specs: []catalog.ChangeSpec{{
		ID: "deliver-local-auction-mvp", Slug: "deliver-local-auction-mvp", Title: "Deliver local auction MVP",
		Format: "openspec", Lifecycle: "implementing", Source: "openspec/changes/deliver-local-auction-mvp",
		Artifacts:    []catalog.SpecArtifact{{Kind: "proposal", Path: "proposal.md", Body: "## Why\nShip locally."}},
		Requirements: []catalog.SpecRequirement{{ID: "auction:create", Title: "Create an auction", Text: "The system SHALL create an auction.", Source: "specs/auction/spec.md:3", Scenarios: []catalog.SpecScenario{{Name: "Seller creates an auction", When: []string{"a valid lot is submitted"}, Then: []string{"the auction is visible"}}}}},
		Tasks:        []catalog.SpecTask{{ID: "1.1", Title: "Create storage", Done: true, Source: "tasks.md:3"}, {ID: "1.2", Title: "Add UI", Source: "tasks.md:4"}},
	}}}

	files := renderedFiles(render(plugin.Request{Catalog: cat}, Options{}))
	index := files["spec/README.md"]
	detail := files["spec/deliver-local-auction-mvp.md"]
	if !strings.Contains(index, "1 / 2") || !strings.Contains(index, "implementation evidence is tracked separately") {
		t.Fatalf("spec index does not separate checklist progress from evidence:\n%s", index)
	}
	for _, want := range []string{"Create an auction", "Seller creates an auction", "**WHEN** a valid lot is submitted", "**THEN** the auction is visible", "Create storage", "Checklist progress is author intent"} {
		if !strings.Contains(detail, want) {
			t.Errorf("spec detail missing %q:\n%s", want, detail)
		}
	}
}
