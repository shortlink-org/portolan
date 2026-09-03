package catalog

import (
	"encoding/json"
	"testing"
)

// TestEdgeViaRoundTrip pins the one field no committed catalog carries: `via`
// is written by the host after the merge, so the roundtrip over data/*.json
// never sees it, and the mirror would drop it silently on the way to a
// generator.
func TestEdgeViaRoundTrip(t *testing.T) {
	in := `{"service":"payments.ledger","status":"declared","via":{"flow":"order-accepted","step":"a3"}}`

	var c EventConsumer
	if err := json.Unmarshal([]byte(in), &c); err != nil {
		t.Fatal(err)
	}
	if c.Via == nil || c.Via.Flow != "order-accepted" || c.Via.Step != "a3" {
		t.Fatalf("via not read: %+v", c.Via)
	}

	out, err := json.Marshal(&c)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != in {
		t.Fatalf("round trip changed the consumer:\n got %s\nwant %s", out, in)
	}

	var call RpcCall
	if err := json.Unmarshal([]byte(`{"id":"x/Y","peer":"p","status":"declared","source":"s"}`), &call); err != nil {
		t.Fatal(err)
	}
	if call.Via != nil {
		t.Fatalf("a call without via must round-trip without one: %+v", call.Via)
	}
}
