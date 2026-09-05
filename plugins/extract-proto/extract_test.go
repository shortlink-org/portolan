package main

// The mapping: protos in a tree, a catalog fragment out.
//
// Shaped like plugins/extract-openapi/extract_test.go, which is the house style
// for an extractor test - one behaviour per test, and a whole-fragment golden
// underneath so an unintended field change is a diff rather than an assertion
// nobody thought to write.

import (
	"encoding/json"
	"flag"
	"os"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

var update = flag.Bool("update", false, "rewrite the golden fragment instead of comparing against it")

const goldenPath = "testdata/golden/proto.json"

func options() Options {
	return Options{
		Context:  "shop",
		Service:  "oms",
		Paths:    []string{"proto"},
		Vendored: []string{"internal/infrastructure/pricing"},
		Peers:    map[string]string{"pricing.v1": "shop.pricing"},
		Out:      "proto.json",
	}
}

func input() plugin.Input {
	// The stamp comes from the host, which derives it from git. A plugin that
	// read a clock would write a different file every run.
	return plugin.Input{
		Root:        "testdata/estate",
		Commit:      "abc1234",
		GeneratedAt: "2024-01-01T00:00:00Z",
	}
}

func response(t *testing.T) plugin.Response {
	t.Helper()

	resp, err := extract(input(), options())
	if err != nil {
		t.Fatal(err)
	}

	return resp
}

func fragment(t *testing.T) catalog.Catalog {
	t.Helper()

	resp := response(t)
	if len(resp.Files) != 1 || resp.Files[0].Name != "proto.json" {
		t.Fatalf("files: %+v", resp.Files)
	}

	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}

	return out
}

func service(t *testing.T) catalog.Service {
	t.Helper()

	return fragment(t).Contexts[0].Services[0]
}

// A proto service is an interface, named by its package and its own name -
// already the spelling RpcService.id documents.
func TestProtoServiceBecomesAnInterface(t *testing.T) {
	provides := service(t).Provides

	if len(provides) != 1 {
		t.Fatalf("provides: %+v", provides)
	}
	orders := provides[0]
	if orders.ID != "shop.v1.Orders" {
		t.Errorf("interface id: %q", orders.ID)
	}
	if orders.Source != "testdata/estate/proto/shop/v1/orders.proto:16" {
		t.Errorf("source must name the file and the line: %q", orders.Source)
	}
	if orders.Module != "buf.build/acme/shop" {
		t.Errorf("the interface does not name the module it came from: %q", orders.Module)
	}
}

// The shapes on either side and how the method streams: the whole reason
// RpcService.methods stopped being a list of strings.
func TestMethodsCarryShapesAndStreaming(t *testing.T) {
	methods := map[string]catalog.RpcMethod{}
	for _, m := range service(t).Provides[0].Methods {
		methods[m.Name] = m
	}

	place := methods["PlaceOrder"]
	if place.Request != "PlaceOrderRequest" || place.Response != "PlaceOrderResponse" {
		t.Errorf("PlaceOrder: %q -> %q", place.Request, place.Response)
	}
	if place.Streaming != "" {
		t.Errorf("a unary method must not claim to stream: %q", place.Streaming)
	}
	if place.Doc == "" {
		t.Error("the comment above a method did not reach the catalog")
	}

	if got := methods["WatchOrder"].Streaming; got != catalog.StreamingServer {
		t.Errorf("WatchOrder streams %q", got)
	}
	if got := methods["ImportOrders"].Streaming; got != catalog.StreamingClient {
		t.Errorf("ImportOrders streams %q", got)
	}
	if got := methods["Sync"].Streaming; got != catalog.StreamingBidi {
		t.Errorf("Sync streams %q", got)
	}
	if !methods["CancelOrder"].Deprecated {
		t.Error("a deprecated method is not marked deprecated")
	}
}

// Reachable messages, not every message in the file: a reader wants what the
// methods actually move.
func TestMessagesAreReachedTransitively(t *testing.T) {
	names := map[string]bool{}
	for _, m := range service(t).Provides[0].Messages {
		names[m.Name] = true
	}

	for _, want := range []string{"PlaceOrderRequest", "PlaceOrderResponse", "Order", "LineItem"} {
		if !names[want] {
			t.Errorf("%s is moved by a method but is not listed", want)
		}
	}
	// Money is reached through PlaceOrderRequest.total, two hops from a method.
	if !names["Money"] {
		t.Error("a message reached through another message was not followed")
	}
}

// A type the author put in ANOTHER file is shared: an import is their own
// signal that it is not local to this message.
func TestImportedTypesBecomeDefs(t *testing.T) {
	frag := fragment(t)

	if _, ok := frag.Defs["Money"]; !ok {
		t.Fatalf("Money was not promoted to a shared type: %v", frag.Defs)
	}
	// The key is BARE, not fully qualified - see src/merge.ts on why.
	for key := range frag.Defs {
		if strings.Contains(key, ".") {
			t.Errorf("a def key is fully qualified: %q", key)
		}
	}

	var total *catalog.Field
	for _, msg := range frag.Contexts[0].Services[0].Provides[0].Messages {
		if msg.Name != "PlaceOrderRequest" {
			continue
		}
		for i := range msg.Fields {
			if msg.Fields[i].Name == "total" {
				total = &msg.Fields[i]
			}
		}
	}
	if total == nil {
		t.Fatal("no total field")
	}
	if total.Ref != "Money" {
		t.Errorf("the field does not point at the shared type: %+v", total)
	}
	// A type local to the file it is used in is NOT shared.
	if _, ok := frag.Defs["LineItem"]; ok {
		t.Error("a type local to its own file was promoted to a shared type")
	}
}

// Types as written, because a reader comparing the page against the file it
// came from should recognise what they are looking at.
func TestFieldTypesAreRenderedTheWayTheCatalogRendersThem(t *testing.T) {
	byName := map[string]string{}
	for _, msg := range service(t).Provides[0].Messages {
		if msg.Name != "PlaceOrderRequest" {
			continue
		}
		for _, f := range msg.Fields {
			byName[f.Name] = f.Type
		}
	}

	want := map[string]string{
		"customer_id": "string",
		"items":       "[]LineItem",
		"coupon":      "string",
		"metadata":    "map[string]string",
		"total":       "Money",
	}
	for name, typ := range want {
		if byName[name] != typ {
			t.Errorf("%s: %q, want %q", name, byName[name], typ)
		}
	}
}

// A vendored copy is a statement about what this service intends to call.
func TestVendoredProtosBecomeCalls(t *testing.T) {
	consumes := service(t).Consumes

	if len(consumes) != 2 {
		t.Fatalf("consumes: %+v", consumes)
	}
	quote := consumes[0]
	if quote.ID != "pricing.v1.Pricing/GetQuote" {
		t.Errorf("call id: %q", quote.ID)
	}
	// The id is exactly the key buildIndex builds rpcProviderByMethod by, which
	// is what makes a call and a provided method meet with no other machinery.
	if quote.Peer != "shop.pricing" {
		t.Errorf("a mapped peer was not resolved: %q", quote.Peer)
	}
	if !strings.Contains(quote.Note, "narrowed copy") {
		t.Errorf("the header comment of the vendored copy did not reach the note: %q", quote.Note)
	}
}

// THE INVARIANT MOST LIKELY TO BE HELPFULLY BROKEN LATER.
//
// Reading a .proto proves the call was WRITTEN DOWN, which is what `declared`
// means. `verified` in the shipped catalog means a test exercises the call end
// to end, and no extractor can know that: verification is a property of the
// union, and every extractor runs before one exists.
func TestNoCallIsEverVerified(t *testing.T) {
	for _, call := range service(t).Consumes {
		if call.Status != catalog.StatusDeclared {
			t.Errorf("%s is %q; an extractor may only declare", call.ID, call.Status)
		}
	}
}

// Without a peer mapping the raw package name survives, because guessing a
// service id from a proto package would be inventing an edge.
func TestUnmappedPeerKeepsTheRawPackageName(t *testing.T) {
	opts := options()
	opts.Peers = nil

	resp, err := extract(input(), opts)
	if err != nil {
		t.Fatal(err)
	}

	var frag catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &frag); err != nil {
		t.Fatal(err)
	}
	call := frag.Contexts[0].Services[0].Consumes[0]
	if call.Peer != "pricing.v1" {
		t.Errorf("peer: %q, want the raw package name", call.Peer)
	}
	if !warned(resp, "no peer is mapped") {
		t.Error("an unmapped peer was resolved silently")
	}
}

// A module the estate publishes has an owner; the lock beside it says which
// commit it was built from.
func TestOwnedModuleIsDescribed(t *testing.T) {
	modules := fragment(t).Modules

	var shop *catalog.ProtoModule
	for i := range modules {
		if modules[i].ID == "buf.build/acme/shop" {
			shop = &modules[i]
		}
	}
	if shop == nil {
		t.Fatalf("modules: %+v", modules)
	}

	if shop.Slug != "acme-shop" || shop.Name != "acme/shop" || shop.Registry != "buf.build" {
		t.Errorf("module identity: %+v", shop)
	}
	if shop.Owner != "shop.oms" {
		t.Errorf("a module this service publishes has no owner: %q", shop.Owner)
	}
	if shop.Commit == "" || shop.Digest == "" {
		t.Errorf("the lock's commit and digest did not reach the module: %+v", shop)
	}
	if len(shop.Packages) != 1 || shop.Packages[0] != "shop.v1" {
		t.Errorf("packages: %v", shop.Packages)
	}
	if len(shop.Files) != 2 || shop.Files[0] != "shop/v1/money.proto" {
		t.Errorf("files must be module-relative and sorted: %v", shop.Files)
	}
}

// A vendored module is published by somebody else. Owner is left empty rather
// than guessed - a publisher outside the estate is the ordinary case.
func TestVendoredModuleHasNoOwner(t *testing.T) {
	for _, m := range fragment(t).Modules {
		if m.ID == "buf.build/acme/shop" {
			continue
		}
		if m.Owner != "" {
			t.Errorf("a vendored module claims an owner: %+v", m)
		}
		if !strings.HasPrefix(m.ID, "local:") {
			t.Errorf("an unpinned directory should be listed as local: %q", m.ID)
		}
	}
}

// A narrowed copy imports files nobody vendored beside it - `pricing.proto`
// here imports a `money.proto` that is not in the tree, and its `Quote.total`
// names a type nothing declares.
//
// A compiler refuses to produce anything for that input. This must read every
// service and method that IS present, which is the whole reason the parser is
// tolerant rather than correct.
func TestNarrowedCopyIsStillFullyRead(t *testing.T) {
	consumes := service(t).Consumes

	if len(consumes) != 2 {
		t.Fatalf("a copy with an unresolvable import was not fully read: %+v", consumes)
	}
	for _, call := range consumes {
		if call.Source == "" || call.Peer == "" {
			t.Errorf("a call from a narrowed copy is incomplete: %+v", call)
		}
	}
}

// The fragment claims only what this extractor knows. The name, repo, readme
// and aggregates belong to other extractors reading other files, and a fragment
// that filled them in would be inventing.
func TestFragmentClaimsNothingItDoesNotKnow(t *testing.T) {
	svc := service(t)

	if svc.Name != "" || svc.Repo != "" || svc.Readme != "" || svc.Path != "" {
		t.Errorf("the fragment named the service: %+v", svc)
	}
	if len(svc.Aggregates) != 0 {
		t.Errorf("the fragment invented aggregates: %+v", svc.Aggregates)
	}
	if len(fragment(t).Flows) != 0 || len(fragment(t).Adrs) != 0 {
		t.Error("the fragment invented flows or decisions")
	}
}

// The fragment is committed and compared by gen:check. A map iterated in Go's
// order would rewrite the file every run and turn every build into a diff.
func TestOutputIsByteIdentical(t *testing.T) {
	first, err := extract(input(), options())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		again, err := extract(input(), options())
		if err != nil {
			t.Fatal(err)
		}
		if again.Files[0].Contents != first.Files[0].Contents {
			t.Fatal("two runs over the same tree produced different fragments")
		}
	}
}

// The whole fragment, so a field that changes shape shows up as a diff rather
// than slipping past every assertion above.
func TestGoldenFragment(t *testing.T) {
	got := response(t).Files[0].Contents

	if *update {
		if err := os.WriteFile(goldenPath, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Log("golden fragment rewritten")

		return
	}

	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("reading the golden fragment: %v (run `go test ./plugins/extract-proto -update`)", err)
	}
	if string(want) != got {
		t.Errorf("the fragment differs from the golden file\n%s", firstDifference(string(want), got))
	}
}

func warned(resp plugin.Response, substring string) bool {
	for _, d := range resp.Warnings() {
		if strings.Contains(d.Message, substring) {
			return true
		}
	}

	return false
}

func firstDifference(want, got string) string {
	a := strings.Split(want, "\n")
	b := strings.Split(got, "\n")
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return "line " + itoa(i+1) + ":\n  want: " + a[i] + "\n  got:  " + b[i]
		}
	}

	return "want " + itoa(len(a)) + " lines, got " + itoa(len(b))
}

func itoa(n int) string {
	return strings.TrimSpace(strings.Replace(strings.Repeat(" ", 0)+string(rune(0)), string(rune(0)), fmtInt(n), 1))
}

func fmtInt(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}

	return string(digits)
}
