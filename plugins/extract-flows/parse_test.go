package main

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

const sample = `# Order accepted
owner: shop
source: services/oms/test/integration/order_accepted_test.go

The narrow slice one integration test pins end to end: an order commits
with its outbox row.

Every hop here is asserted.

## Participants
- oms-db: store in shop "oms-db (postgres)"
- psp-gateway: external "psp-gateway (external)"
- customer: actor

## Steps
// the request
customer -> shop.oms: rpc PlaceOrder [verified] @internal/oms/http/orders.go:40
shop.oms -> oms-db: insertOrderAndOutboxRow [verified] @internal/oms/adapter/postgres/order_repo.go:141 #a1
  > The order row and the OrderPlaced outbox row commit in one
  > transaction.
shop.oms -> bus: event shop.oms.order.OrderPlaced [verified]
payments.ledger -> psp-gateway: rpc psp.v2.Charges/Create as "Charges.Create (auth only)" [unresolved] @internal/ledger/adapter/psp/client.go:64

alt score below 40 #alt-risk
  bus -> payments.ledger: event shop.oms.order.OrderPlaced
else score at or above 40
  shop.oms -> bus: event shop.oms.order.OrderCancelled
  stop
else
end

par OrderPlaced fan-out #par-placed
  bus -> payments.ledger: event shop.oms.order.OrderPlaced
and
  bus -> delivery.core: event shop.oms.order.OrderPlaced
end

loop outbox relay, every 200 ms until the batch is empty
  shop.oms -> oms-db: SELECT ... FOR UPDATE SKIP LOCKED
end
`

func parsed(t *testing.T, src string) catalog.Flow {
	t.Helper()
	flow, errs := parseFlow("data/flows/order-accepted.flow.md", src)
	if len(errs) > 0 {
		t.Fatalf("errors: %s", strings.Join(errs, "\n"))
	}

	return flow
}

func TestTheHeadIsReadIntoTheFlow(t *testing.T) {
	flow := parsed(t, sample)
	if flow.ID != "flow.order-accepted" || flow.Slug != "order-accepted" || flow.Name != "Order accepted" || flow.Owner != "shop" {
		t.Errorf("flow = %+v", flow)
	}
	if flow.Source != "services/oms/test/integration/order_accepted_test.go" {
		t.Errorf("source = %q", flow.Source)
	}
	want := "The narrow slice one integration test pins end to end: an order commits with its outbox row.\n\nEvery hop here is asserted."
	if flow.Summary != want {
		t.Errorf("summary = %q", flow.Summary)
	}
}

// Declared lanes come first, in the order written; the ones a step brings in
// - services by their id, the bus by its name - follow in order of first use.
func TestLanesAreDeclaredOrInferred(t *testing.T) {
	flow := parsed(t, sample)
	var ids []string
	for _, p := range flow.Participants {
		ids = append(ids, p.ID+"/"+string(p.Kind))
	}
	want := "oms-db/store psp-gateway/external customer/actor shop.oms/service bus/broker payments.ledger/service delivery.core/service"
	if strings.Join(ids, " ") != want {
		t.Errorf("lanes = %s", strings.Join(ids, " "))
	}
	if store := flow.Participants[0]; store.Label != "oms-db (postgres)" || store.Context == nil || *store.Context != "shop" {
		t.Errorf("store lane = %+v", store)
	}
	if oms := flow.Participants[3]; oms.Context == nil || *oms.Context != "shop" {
		t.Errorf("service lane = %+v", oms)
	}
}

func TestAHopCarriesEverythingWrittenAfterIt(t *testing.T) {
	flow := parsed(t, sample)
	first := flow.Steps[0].(*catalog.Step)
	if first.ID != "s1" || first.Kind != catalog.StepRPC || first.Label != "PlaceOrder" || first.Ref != "" || first.Status != catalog.StatusVerified || first.Line != "internal/oms/http/orders.go:40" {
		t.Errorf("first = %+v", first)
	}
	second := flow.Steps[1].(*catalog.Step)
	if second.ID != "a1" || second.Kind != catalog.StepCall || second.Label != "insertOrderAndOutboxRow" {
		t.Errorf("second = %+v", second)
	}
	if second.Note != "The order row and the OrderPlaced outbox row commit in one transaction." {
		t.Errorf("note = %q", second.Note)
	}
	third := flow.Steps[2].(*catalog.Step)
	if third.ID != "s2" || third.Ref != "shop.oms.order.OrderPlaced" || third.Label != "OrderPlaced" || third.From != "shop.oms" || third.To != "bus" {
		t.Errorf("third = %+v; an explicit id does not use up a number", third)
	}
	fourth := flow.Steps[3].(*catalog.Step)
	if fourth.Ref != "psp.v2.Charges/Create" || fourth.Label != "Charges.Create (auth only)" || fourth.Status != catalog.StatusUnresolved {
		t.Errorf("fourth = %+v", fourth)
	}
}

func TestFramesCloseWithEnd(t *testing.T) {
	flow := parsed(t, sample)
	alt, ok := flow.Steps[4].(*catalog.Alt)
	if !ok || alt.ID != "alt-risk" || len(alt.Branches) != 3 {
		t.Fatalf("alt = %+v", flow.Steps[4])
	}
	if alt.Branches[0].Title != "score below 40" || alt.Branches[0].Terminal || len(alt.Branches[0].Steps) != 1 {
		t.Errorf("branch 0 = %+v", alt.Branches[0])
	}
	if alt.Branches[1].Title != "score at or above 40" || !alt.Branches[1].Terminal {
		t.Errorf("branch 1 = %+v; `stop` makes it terminal", alt.Branches[1])
	}
	if alt.Branches[2].Title != "otherwise" || len(alt.Branches[2].Steps) != 0 {
		t.Errorf("branch 2 = %+v; a bare else is otherwise, and empty is allowed", alt.Branches[2])
	}

	par, ok := flow.Steps[5].(*catalog.Parallel)
	if !ok || par.ID != "par-placed" || par.Title != "OrderPlaced fan-out" || len(par.Branches) != 2 {
		t.Fatalf("par = %+v", flow.Steps[5])
	}
	loop, ok := flow.Steps[6].(*catalog.Loop)
	if !ok || loop.ID != "loop8" || !strings.HasPrefix(loop.Title, "outbox relay") || len(loop.Steps) != 1 {
		t.Fatalf("loop = %+v", flow.Steps[6])
	}
}

// An rpc with no interface behind it - a webhook arriving on a route - keeps
// the route as its label and has no ref to resolve.
func TestARouteIsALabelNotARef(t *testing.T) {
	src := "# Webhook\nowner: payments\n\n## Participants\n- psp-gateway: external\n\n## Steps\npsp-gateway -> payments.ledger: rpc POST /webhooks/psp/v2 [verified]\npayments.ledger -> shop.oms: rpc shop.v1.Orders/GetOrder\n"
	flow, errs := parseFlow("w.flow.md", src)
	if len(errs) > 0 {
		t.Fatal(errs)
	}
	first := flow.Steps[0].(*catalog.Step)
	if first.Ref != "" || first.Label != "POST /webhooks/psp/v2" {
		t.Errorf("first = %+v", first)
	}
	second := flow.Steps[1].(*catalog.Step)
	if second.Ref != "shop.v1.Orders/GetOrder" || second.Label != "GetOrder" {
		t.Errorf("second = %+v", second)
	}
}

func TestTheFileIsTheSourceWhenNoneIsNamed(t *testing.T) {
	src := "# Login\nowner: auth\n\n## Steps\nclient -> auth.auth: rpc login\n"
	flow, errs := parseFlow("data/flows/login.flow.md", src)
	if len(errs) > 0 {
		t.Fatal(errs)
	}
	if flow.Source != "data/flows/login.flow.md" || flow.Slug != "login" {
		t.Errorf("flow = %+v", flow)
	}
	if flow.Participants[0].Kind != catalog.ParticipantActor || flow.Participants[0].ID != "client" {
		t.Errorf("client is an actor by name: %+v", flow.Participants)
	}
}

// Every mistake is named with its line, and none of them is silent.
func TestMistakesAreNamedWithTheirLine(t *testing.T) {
	cases := []struct{ src, want string }{
		{"# X\nowner: a\n\n## Steps\na.b -> c.d: hop\nalt when\n  a.b -> c.d: x\n", "alt is never closed"},
		{"# X\nowner: a\n\n## Steps\nalt when\n  a.b -> c.d: x\nend\n", "needs an `else`"},
		{"# X\nowner: a\n\n## Steps\nalt when\n  a.b -> c.d: x\n  stop\nelse\n  a.b -> c.d: y\n  stop\nend\n", "every branch of this alt stops"},
		{"# X\nowner: a\n\n## Steps\na.b -> mystery: hop\n", `"mystery" is not declared`},
		{"# X\nowner: a\n\n## Steps\na.b -> c.d: hop [maybe]\n", "not one of verified"},
		{"# X\nowner: a\n\n## Steps\na.b -> c.d: hop #s1\na.b -> c.d: hop #s1\n", "used twice"},
		{"# X\nowner: a\n\n## Steps\n> orphan\n", "has to follow the step"},
		{"# X\n\n## Steps\na.b -> c.d: hop\n", "no owner"},
		{"# X\nowner: a\n\n## Steps\nloop\n  a.b -> c.d: hop\nend\n", "loop needs a title"},
		{"# X\nowner: a\n\n## Steps\nalt when\n  a.b -> c.d: x\n  stop\n  a.b -> c.d: y\nelse\nend\n", "nothing runs after `stop`"},
		{"# X\nowner: a\n\n## Steps\na.b -> c.d: hop [verified] wat\n", "cannot read"},
	}
	for _, c := range cases {
		_, errs := parseFlow("f.flow.md", c.src)
		if len(errs) == 0 {
			t.Errorf("%q: no error, want %q", c.src, c.want)

			continue
		}
		joined := strings.Join(errs, "\n")
		if !strings.Contains(joined, c.want) || !strings.Contains(joined, "f.flow.md:") {
			t.Errorf("%q: errors = %q, want %q with a line", c.src, joined, c.want)
		}
	}
}
