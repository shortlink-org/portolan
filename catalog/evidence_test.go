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

// An inferred verb keeps its basis and its reading on the provided route, and
// the link resolved against it keeps the lowered confidence beside the same
// reading. A declared route writes neither, which is how it reads declared.
func TestInferredHTTPMethodRoundTrip(t *testing.T) {
	raw := `{"name":"geo_upload_csv","http":{"method":"POST","path":"/geo/upload_csv","methodBasis":"inferred",
		"methodEvidence":{"rule":"reads request.FILES","source":"geo/views.py:64"}}}`
	var method RpcMethod
	if err := json.Unmarshal([]byte(raw), &method); err != nil {
		t.Fatal(err)
	}
	if method.HTTP == nil || method.HTTP.MethodBasis != HTTPMethodInferred || method.HTTP.MethodEvidence == nil || method.HTTP.MethodEvidence.Source != "geo/views.py:64" {
		t.Fatalf("inferred verb not read: %+v", method.HTTP)
	}
	out, err := json.Marshal(method)
	if err != nil {
		t.Fatal(err)
	}
	var before, after any
	_ = json.Unmarshal([]byte(raw), &before)
	_ = json.Unmarshal(out, &after)
	if diffs := compare("method", normalize(before), normalize(after)); len(diffs) != 0 {
		t.Fatalf("round trip lost something: %v", diffs)
	}

	declared, err := json.Marshal(HttpRoute{Method: "GET", Path: "/ping"})
	if err != nil {
		t.Fatal(err)
	}
	if string(declared) != `{"method":"GET","path":"/ping"}` {
		t.Fatalf("a declared route grew fields: %s", declared)
	}

	resolution := HTTPDestinationResolution{Basis: "exact-route", Provider: "avia.aviaadmin", Route: "/geo/upload_csv", Confidence: "medium", MethodEvidence: method.HTTP.MethodEvidence}
	encoded, err := json.Marshal(resolution)
	if err != nil {
		t.Fatal(err)
	}
	var decoded HTTPDestinationResolution
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resolution, decoded) {
		t.Fatalf("resolution changed: %s", encoded)
	}
}
