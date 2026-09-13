package genmarkdown

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestFlowPageCarriesIntegrationAndCompositionEvidence(t *testing.T) {
	cat := fixtureCatalog(t)
	if len(cat.Flows) == 0 || len(cat.Stores) == 0 {
		t.Fatal("fixture needs a flow and a store")
	}
	flow := &cat.Flows[0]
	steps := flowSteps(flow.Steps)
	if len(steps) == 0 || len(flow.Participants) == 0 {
		t.Fatal("fixture flow needs steps and participants")
	}
	step := steps[0]
	store := cat.Stores[0]
	flow.Includes = []string{"worker-fragment"}
	flow.Composition = []catalog.FlowComposition{{
		Flow:   "worker-fragment",
		Source: "workers/issue.go:20",
		Seam: catalog.FlowCompositionSeam{
			AfterStep:  step.ID,
			Kind:       "entrypoint",
			Target:     "billing.issue",
			Basis:      "exact source entrypoint",
			Confidence: "high",
		},
	}}
	flow.Participants[0].EntityRef = flow.Participants[0].ID
	step.ContinuesAt = "billing.issue"
	step.Handoff = &catalog.FlowHandoff{Kind: "message", Transport: "kafka", Channel: "invoice", Direction: "send"}
	step.StoreAccess = &catalog.FlowStoreAccess{Store: store.ID, Operation: catalog.RedisOperationWrite, Keyspace: "invoice:*", Method: "Save"}
	step.Kind = catalog.StepCall
	step.Evidence = []catalog.RelationEvidence{{Kind: "function", Rule: "exact-symbol", Symbol: "billing.issue"}}

	files := renderedFiles(render(plugin.Request{Catalog: cat}, Options{}))
	page := files["flows/"+flow.Slug+".md"]
	for _, want := range []string{
		"## Composition",
		"worker-fragment",
		"exact source entrypoint",
		"billing.issue",
		"handoff: send · message · kafka · invoice",
		"store:",
		"WRITE",
		"invoice:*",
		"evidence: function · exact-symbol",
	} {
		if !strings.Contains(page, want) {
			t.Errorf("flow page does not contain %q:\n%s", want, page)
		}
	}
}
