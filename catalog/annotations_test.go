package catalog

import (
	"encoding/json"
	"testing"
)

func TestAnnotationsRoundTrip(t *testing.T) {
	raw := []byte(`{"contexts":[],"defs":{},"flows":[],"adrs":[],"annotations":[{"version":1,"catalog":"default","target":{"kind":"service","id":"shop.oms"},"source":"annotations/default/service/shop.oms.json","basis":"declared","properties":{"x-zero":{"type":"number","label":"Count","value":0,"unit":"min"},"x-false":{"type":"boolean","label":"Flag","value":false},"x-json":{"type":"json","label":"Nested","value":{"items":[],"flag":false,"n":null}},"x-link":{"type":"link","label":"Runbook","value":{"url":"https://example.com","label":"Open","purpose":"runbook"}}},"order":["x-zero","x-false","x-json","x-link"]}]}`)
	var parsed Catalog
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(parsed)
	if err != nil {
		t.Fatal(err)
	}
	var before, after any
	json.Unmarshal(raw, &before)
	json.Unmarshal(encoded, &after)
	if diffs := compare("catalog", normalize(before), normalize(after)); len(diffs) > 0 {
		t.Fatalf("annotations changed in Go round trip: %v", diffs)
	}
}
