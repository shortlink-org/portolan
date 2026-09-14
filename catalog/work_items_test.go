package catalog

import (
	"encoding/json"
	"os"
	"testing"
)

func TestWorkItemsRoundTrip(t *testing.T) {
	raw, err := os.ReadFile("../src/testing/fixtures/work-items.json")
	if err != nil {
		t.Fatal(err)
	}
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
		t.Fatalf("work items changed in Go round trip: %v", diffs)
	}
}
