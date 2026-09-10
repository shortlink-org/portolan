package catalog

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestRelationEvidenceSurvivesEverySupportedCarrier(t *testing.T) {
	evidence := []RelationEvidence{{Kind: "binding", Rule: "provider-signature", Source: "di.go:14", Symbol: "Provide", Candidates: []string{"one", "two"}}}
	before := struct {
		Step     Step
		Call     RpcCall
		Table    Table
		Persists Persists
	}{
		Step: Step{Evidence: evidence}, Call: RpcCall{Evidence: evidence},
		Table: Table{Evidence: evidence}, Persists: Persists{Evidence: evidence},
	}
	raw, err := json.Marshal(before)
	if err != nil {
		t.Fatal(err)
	}
	after := before
	after.Step.Evidence = nil
	after.Call.Evidence = nil
	after.Table.Evidence = nil
	after.Persists.Evidence = nil
	if err := json.Unmarshal(raw, &after); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("evidence changed: %s", raw)
	}
}
