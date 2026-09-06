package catalog

import (
	"encoding/json"
	"testing"
)

// An enum round-trips whole: the aggregate's list, the values with their
// docs, the deprecation marks - and the proto side's numbers. The fixture is
// literal rather than read from a catalog so that the test says exactly what
// the mirror is expected to keep.
func TestEnumRoundTrip(t *testing.T) {
	raw := `{"id":"a","slug":"a","name":"A","readme":"","root":"A","entities":[],"valueObjects":[],"operations":[],"events":[],
		"enums":[{"id":"shop.oms.order.status","slug":"status","name":"Status","doc":"Where an order is.","deprecated":true,
		"values":[{"name":"placed","doc":"just in"},{"name":"legacy","doc":"","deprecated":true}]}]}`

	var agg Aggregate
	if err := json.Unmarshal([]byte(raw), &agg); err != nil {
		t.Fatal(err)
	}
	if len(agg.Enums) != 1 || agg.Enums[0].ID != "shop.oms.order.status" || !agg.Enums[0].Deprecated {
		t.Fatalf("enum not read: %+v", agg.Enums)
	}
	if got := agg.Enums[0].Values; len(got) != 2 || got[0].Name != "placed" || !got[1].Deprecated {
		t.Fatalf("values not read: %+v", got)
	}

	out, err := json.Marshal(agg)
	if err != nil {
		t.Fatal(err)
	}
	var before, after any
	_ = json.Unmarshal([]byte(raw), &before)
	_ = json.Unmarshal(out, &after)
	if diffs := compare("aggregate", normalize(before), normalize(after)); len(diffs) != 0 {
		t.Fatalf("round trip lost something: %v", diffs)
	}

	var svc RpcService
	if err := json.Unmarshal([]byte(`{"id":"shop.v1.OrderService","methods":[],"source":"","enums":[{"name":"Status","values":[{"name":"STATUS_UNSPECIFIED","number":0},{"name":"PLACED","number":1,"doc":"in"}]}]}`), &svc); err != nil {
		t.Fatal(err)
	}
	if len(svc.Enums) != 1 || svc.Enums[0].Values[1].Number != 1 || svc.Enums[0].Values[0].Number != 0 {
		t.Fatalf("proto enum not read: %+v", svc.Enums)
	}
}
