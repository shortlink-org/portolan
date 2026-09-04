package main

import (
	"testing"
)

// The same rule as for Go, read off text: the chain from the aggregate, one
// conversion allowed round it, a method on the value stripped.
func TestFieldOfTSFollowsTheChainAndOneWrapper(t *testing.T) {
	cases := map[string]string{
		"basket.id":                      "id",
		"basket.customerId":              "customerId",
		"basket.touchedAt.toISOString()": "touchedAt",
		"basket.unitPrice?.amountMinor":  "unitPrice.amountMinor",
		"nullable(basket.checkedOutAt)":  "checkedOutAt",
		"String(basket.version)":         "version",
		"JSON.stringify(toWire(event))":  "",
		"randomUUID()":                   "",
		"new Date()":                     "",
		"combine(basket.a, basket.b)":    "",
		"TOPIC":                          "",
		"'literal'":                      "",
	}
	for in, want := range cases {
		if got := fieldOfTS(in); got != want {
			t.Errorf("fieldOfTS(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestInsertCallsPairAStatementWithItsArray(t *testing.T) {
	source := `
await client.query("BEGIN"); // a literal before, which must not swallow what follows
await client.query(
  "INSERT INTO baskets (id, token, version) VALUES ($1, $2, 1)",
  [basket.id, basket.token],
);
const rows = await this.pool.query<Row>("SELECT * FROM baskets WHERE id = $1", [id]);
await client.query("INSERT INTO outbox (uuid, payload) VALUES ($1, $2)", [randomUUID(), JSON.stringify({ a: [1, 2] })]);
`
	calls := insertCalls(source)
	if len(calls) != 2 {
		t.Fatalf("found %d inserts, want 2", len(calls))
	}
	if len(calls[0].args) != 2 || calls[0].args[1] != "basket.token" {
		t.Fatalf("first insert args = %q", calls[0].args)
	}
	if len(calls[1].args) != 2 || calls[1].args[1] != "JSON.stringify({ a: [1, 2] })" {
		t.Fatalf("second insert args = %q", calls[1].args)
	}
}
