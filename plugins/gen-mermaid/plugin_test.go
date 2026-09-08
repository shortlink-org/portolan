package genmermaid

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"github.com/shortlink-org/portolan/plugin/schematest"
)

func TestOptionsSchema(t *testing.T) { schematest.Check(t, optionsSchema, Options{}) }

func TestRenderIsSortedAndIndexed(t *testing.T) {
	cat := catalog.Catalog{Flows: []catalog.Flow{
		{ID: "flow.z", Slug: "z", Name: "Z", Participants: []catalog.Participant{{ID: "a", Kind: catalog.ParticipantActor}, {ID: "b", Kind: catalog.ParticipantService}}, Steps: catalog.FlowNodes{&catalog.Step{Type: "step", ID: "s1", From: "a", To: "b", Kind: catalog.StepCall, Label: "go"}}},
		{ID: "flow.a", Slug: "a", Name: "A"},
	}}
	resp := render(plugin.Request{Catalog: cat}, Options{})
	if resp.Files[0].Name != "a.mmd" || resp.Files[1].Name != "z.mmd" {
		t.Fatalf("files are not stable: %+v", resp.Files)
	}
	var index struct {
		Flows []indexEntry `json:"flows"`
	}
	if err := json.Unmarshal([]byte(resp.Files[len(resp.Files)-1].Contents), &index); err != nil || len(index.Flows) != 2 {
		t.Fatalf("bad index: %v %+v", err, index)
	}
	if !strings.Contains(resp.Files[1].Contents, "sequenceDiagram") {
		t.Fatalf("not Mermaid: %s", resp.Files[1].Contents)
	}
}
