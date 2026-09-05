package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func fragment(t *testing.T) catalog.Catalog {
	t.Helper()

	resp, err := extract(
		plugin.Input{Root: "testdata", Commit: "abc1234", GeneratedAt: "2026-01-01T00:00:00Z"},
		Options{Context: "storefront", Service: "bff", Schema: "schema", API: "storefront.v1"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Files) != 1 {
		t.Fatalf("expected one fragment, got %d files", len(resp.Files))
	}

	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}

	return out
}

func provided(t *testing.T) []catalog.RpcService {
	t.Helper()

	return fragment(t).Contexts[0].Services[0].Provides
}

func interfaceNamed(t *testing.T, id string) catalog.RpcService {
	t.Helper()

	for _, p := range provided(t) {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("no interface %q in the fragment", id)

	return catalog.RpcService{}
}

func method(t *testing.T, id, name string) catalog.RpcMethod {
	t.Helper()

	for _, m := range interfaceNamed(t, id).Methods {
		if m.Name == name {
			return m
		}
	}
	t.Fatalf("no method %q on %q", name, id)

	return catalog.RpcMethod{}
}

func message(t *testing.T, id, name string) catalog.RpcMessage {
	t.Helper()

	for _, m := range interfaceNamed(t, id).Messages {
		if m.Name == name {
			return m
		}
	}
	t.Fatalf("no message %q on %q", name, id)

	return catalog.RpcMessage{}
}

// A module is how a schema's author says "these fields belong together", the
// way a tag is in an OpenAPI document - and unlike a tag it is a file, so the
// interface can point at something a reader can open.
func TestModulesBecomeInterfaces(t *testing.T) {
	got := map[string]string{}
	for _, p := range provided(t) {
		got[p.ID] = p.Source
	}

	want := map[string]string{
		"storefront.v1.Basket": "testdata/schema/basket/schema.graphql",
		"storefront.v1.Order":  "testdata/schema/order/schema.graphql",
	}
	for id, source := range want {
		if got[id] != source {
			t.Errorf("%s reads %q, want %q", id, got[id], source)
		}
	}
	if len(got) != len(want) {
		t.Errorf("declared %d interfaces, want %d: %v", len(got), len(want), got)
	}
}

// The generator writes the whole schema out again beside the modules it read.
// Reading that copy would give the estate a module nobody wrote, holding every
// field a second time.
func TestTheGeneratedCopyIsNotAModule(t *testing.T) {
	for _, p := range provided(t) {
		if strings.Contains(p.Source, ".generated.") {
			t.Errorf("%s was read out of the generated copy %s", p.ID, p.Source)
		}
	}
}

// A field is named by the operation it belongs to. Two operations may each
// have a `basket` field and they are not the same endpoint.
func TestMethodsAreNamedByOperation(t *testing.T) {
	var names []string
	for _, m := range interfaceNamed(t, "storefront.v1.Basket").Methods {
		names = append(names, m.Name)
	}

	want := []string{"Query.basket", "Query.legacyBasket", "Mutation.addItem"}
	if len(names) != len(want) {
		t.Fatalf("methods are %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("method %d is %q, want %q", i, names[i], want[i])
		}
	}
}

// A subscription keeps answering. Drawn as a call it would be a lie about how
// the two ends are coupled, which is what Streaming exists to prevent.
func TestSubscriptionsAreServerStreams(t *testing.T) {
	if got := method(t, "storefront.v1.Order", "Subscription.orderStatus").Streaming; got != catalog.StreamingServer {
		t.Errorf("streaming is %q, want %q", got, catalog.StreamingServer)
	}
	if got := method(t, "storefront.v1.Basket", "Query.basket").Streaming; got != "" {
		t.Errorf("a query is streaming %q, want unary", got)
	}
}

// A field whose whole input is one input object is already named by the
// schema; a field with loose arguments is not, so a name is made and the
// arguments become its fields.
func TestArgumentsAreNamedOnceAndInventedOtherwise(t *testing.T) {
	if got := method(t, "storefront.v1.Basket", "Mutation.addItem").Request; got != "AddItemInput" {
		t.Errorf("request is %q, want the input object AddItemInput", got)
	}

	if got := method(t, "storefront.v1.Order", "Query.order").Request; got != "QueryOrderArgs" {
		t.Errorf("request is %q, want QueryOrderArgs", got)
	}

	args := message(t, "storefront.v1.Order", "QueryOrderArgs")
	if len(args.Fields) != 2 || args.Fields[0].Name != "id" || args.Fields[1].Name != "at" {
		t.Fatalf("QueryOrderArgs holds %+v, want id and at", args.Fields)
	}
	// `at` is nullable, and the rest of the catalog says that in prose.
	if args.Fields[1].Doc != "Optional." {
		t.Errorf("the nullable argument reads %q, want it marked optional", args.Fields[1].Doc)
	}
}

// A response names a shape, and the shapes it names are walked until nothing
// new is reached: a reader who has to open the schema to find out what a Line
// holds has been given a worse document than the schema.
func TestMessagesFollowWhatTheyReach(t *testing.T) {
	var names []string
	for _, m := range interfaceNamed(t, "storefront.v1.Basket").Messages {
		names = append(names, m.Name)
	}

	for _, want := range []string{"Basket", "Line", "Money", "AddItemInput"} {
		found := false
		for _, name := range names {
			found = found || name == want
		}
		if !found {
			t.Errorf("%s is reachable from the basket module and is not in %v", want, names)
		}
	}
}

// A list is spelled the way every other extractor here spells one, and an enum
// carries its values: a status whose values are three clicks away is a status
// nobody reads.
func TestTypesAreSpelledLikeTheRestOfTheCatalog(t *testing.T) {
	basket := message(t, "storefront.v1.Basket", "Basket")
	byName := map[string]catalog.Field{}
	for _, f := range basket.Fields {
		byName[f.Name] = f
	}

	if got := byName["lines"].Type; got != "[]Line" {
		t.Errorf("lines is %q, want []Line", got)
	}
	if got := byName["quote"].Doc; got != "Optional. Nothing has been priced yet when the basket is empty." {
		t.Errorf("the nullable field reads %q", got)
	}

	order := message(t, "storefront.v1.Order", "Order")
	for _, f := range order.Fields {
		if f.Name == "status" && f.Type != "OrderStatus enum(PLACED | CONFIRMED | CANCELLED)" {
			t.Errorf("status is %q, want the enum and its values", f.Type)
		}
	}
}

// GraphQL is polymorphic in two ways and answers both of them with the same
// field, which is the one a client would select.
func TestUnionsDiscriminateOnTypename(t *testing.T) {
	result := message(t, "storefront.v1.Order", "OrderResult")
	if result.Discriminator == nil {
		t.Fatal("a union came back with no discriminator")
	}
	if result.Discriminator.Property != "__typename" {
		t.Errorf("discriminates on %q, want __typename", result.Discriminator.Property)
	}

	var variants []string
	for _, v := range result.Discriminator.Variants {
		variants = append(variants, v.Message)
	}
	if len(variants) != 2 || variants[0] != "Order" || variants[1] != "OrderNotFound" {
		t.Errorf("variants are %v, want Order and OrderNotFound", variants)
	}
}

// A deprecated field is reported deprecated, and its reason is prose the
// reader gets to see.
func TestDeprecationSurvives(t *testing.T) {
	m := method(t, "storefront.v1.Basket", "Query.legacyBasket")
	if !m.Deprecated {
		t.Error("the deprecated field is not marked deprecated")
	}
	if m.Doc != "Deprecated: Ask for `basket` instead." {
		t.Errorf("doc is %q, want the deprecation reason", m.Doc)
	}
}

// The same schema read twice is the same fragment. Everything that came out of
// a map is sorted, and nothing reads a clock.
func TestExtractionIsDeterministic(t *testing.T) {
	first, err := json.Marshal(fragment(t))
	if err != nil {
		t.Fatal(err)
	}
	second, err := json.Marshal(fragment(t))
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Error("two runs over the same schema produced different fragments")
	}
}
