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
		"basket.items.slice(1)":          "items",
		"JSON.stringify(basket.shipTo)":  "shipTo",
		"basket.customerId ?? null":      "customerId",
		"basket.currency?.code ?? null":  "currency.code",
		"basket.version ?? 0":            "version",
		"basket.a ?? basket.b":           "",
	}
	for in, want := range cases {
		if got := fieldOfTS(in, nil, nil); got != want {
			t.Errorf("fieldOfTS(%q) = %q, want %q", in, got, want)
		}
	}
}

// Once the file says which name is the aggregate, only that name maps: the
// item of a loop over its lines is not the basket.
func TestFieldOfTSReadsOnlyTheRootWhenTheFileNamesIt(t *testing.T) {
	roots := rootVarsTS("async save(basket: Basket, ...events: BasketEvent[]) { for (const item of basket.items) {} }", "Basket")
	if !roots["basket"] || roots["events"] || roots["item"] {
		t.Fatalf("roots = %v", roots)
	}
	cases := map[string]string{
		"basket.id":     "id",
		"item.sku":      "",
		"item.quantity": "",
	}
	for in, want := range cases {
		if got := fieldOfTS(in, roots, nil); got != want {
			t.Errorf("fieldOfTS(%q) = %q, want %q", in, got, want)
		}
	}
	if rootVarsTS("const rows = await pool.query<Row>(sql)", "Basket") != nil {
		t.Error("a file that never names the root should leave every name open")
	}
}

// The variable of a for-of loop stands for one element of what it walks, so
// a column written from it carries a field of the elements of a field.
func TestFieldOfTSFollowsALoopVariable(t *testing.T) {
	aliases := loopAliasesTS(`for (const item of basket.items) { for (const event of events) {} } for (const self of self.items) {}
for (const scan of basket.scans.slice(stored.rows[0]?.n ?? 0)) {}`)
	if aliases["item"] != "basket.items" || aliases["event"] != "events" || aliases["self"] != "self.items" || aliases["scan"] != "basket.scans.slice(stored.rows[0]?.n ?? 0)" {
		t.Fatalf("aliases = %v", aliases)
	}
	roots := map[string]bool{"basket": true}
	cases := map[string]string{
		"item.sku":                     "items.sku",
		"item.unitPrice.currency.code": "items.unitPrice.currency.code",
		"item.touchedAt.toISOString()": "items.touchedAt",
		"scan.parcelId":                "scans.parcelId",
		"event.name":                   "",
		"self.name":                    "",
	}
	for in, want := range cases {
		if got := fieldOfTS(in, roots, aliases); got != want {
			t.Errorf("fieldOfTS(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMapsTSAgainstTheRealService(t *testing.T) {
	b := builderFor(t)
	mapped := readMapsTS("../../examples/shop/cart", "src/infrastructure/repository", "basket", b)

	want := map[string]map[string]string{
		"baskets": {
			"id":          "Basket.id",
			"token":       "Basket.token",
			"customer_id": "Basket.customerId",
			"currency":    "Basket.currency.code",
			"status":      "Basket.status",
			"touched_at":  "Basket.touchedAt",
		},
		"basket_items": {
			"basket_id":        "Basket.id",
			"sku":              "Basket.items.sku",
			"quantity":         "Basket.items.quantity",
			"unit_price_minor": "Basket.items.unitPrice.amountMinor",
			"currency":         "Basket.items.unitPrice.currency.code",
		},
	}
	for table, columns := range want {
		for column, field := range columns {
			if got := mapped[table][column]; got != field {
				t.Errorf("%s.%s -> %q, want %q", table, column, got, field)
			}
		}
		if len(mapped[table]) != len(columns) {
			t.Errorf("%s: mapped %v, want exactly %v", table, mapped[table], columns)
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
