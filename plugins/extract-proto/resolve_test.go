package main

// Name resolution, on its own. A proto reference means whatever the innermost
// enclosing scope that declares it means, and a name nothing declares is a
// diagnostic rather than a failure.

import "testing"

func indexed(t *testing.T) *Index {
	t.Helper()

	orders, _ := parseFile(t, "orders.proto")
	money, _ := parseFile(t, "money.proto")

	return NewIndex([]*File{orders, money})
}

func TestResolvesAcrossFiles(t *testing.T) {
	ix := indexed(t)

	fqn, ok := ix.Resolve("shop.v1", "Money")
	if !ok || fqn != "shop.v1.Money" {
		t.Errorf("Money from shop.v1: %q %v", fqn, ok)
	}
	if ix.Message(fqn) == nil {
		t.Error("the resolved name does not lead back to the message")
	}
}

// Proto searches outwards from where the name was written, so the nested type
// wins over anything of the same name further out.
func TestResolvesInnermostFirst(t *testing.T) {
	ix := indexed(t)

	fqn, ok := ix.Resolve("shop.v1.Order", "Address")
	if !ok || fqn != "shop.v1.Order.Address" {
		t.Errorf("Address from inside Order: %q %v", fqn, ok)
	}

	// The same name written one scope out finds nothing, which is the point.
	if _, ok := ix.Resolve("shop.v1", "Address"); ok {
		t.Error("a nested type resolved from outside the message that nests it")
	}
}

func TestLeadingDotIsAbsolute(t *testing.T) {
	ix := indexed(t)

	fqn, ok := ix.Resolve("shop.v1.Order", ".shop.v1.Money")
	if !ok || fqn != "shop.v1.Money" {
		t.Errorf("absolute name: %q %v", fqn, ok)
	}
}

func TestNestedEnumIsIndexed(t *testing.T) {
	ix := indexed(t)

	fqn, ok := ix.Resolve("shop.v1.Order", "Channel")
	if !ok || fqn != "shop.v1.Order.Channel" {
		t.Errorf("nested enum: %q %v", fqn, ok)
	}
	if ix.Enum(fqn) == nil {
		t.Error("the resolved name does not lead back to the enum")
	}
}

// The whole reason this parser is tolerant: a narrowed vendored copy imports
// files nobody vendored beside it, and it must still be describable.
func TestUnresolvedIsReportedNotFatal(t *testing.T) {
	ix := indexed(t)

	ref := ix.resolveType("shop.v1", &Field{Type: "Nowhere"})
	if ref.Unresolved != "Nowhere" {
		t.Errorf("an unknown type was not reported: %+v", ref)
	}
	if ref.Written != "Nowhere" {
		t.Errorf("an unknown type must still be shown as written: %q", ref.Written)
	}
}

// Types are rendered the way the catalog renders types, and resolved on the
// half that can name a message.
func TestTypeRendering(t *testing.T) {
	ix := indexed(t)

	cases := []struct {
		field        Field
		written, fqn string
	}{
		{Field{Type: "string"}, "string", ""},
		{Field{Type: "Money"}, "Money", "shop.v1.Money"},
		{Field{Type: "shop.v1.Money"}, "Money", "shop.v1.Money"},
		{Field{Type: "LineItem", Label: "repeated"}, "[]LineItem", "shop.v1.LineItem"},
		{Field{Type: "map<string, string>"}, "map[string]string", ""},
		{Field{Type: "map<string, Money>"}, "map[string]Money", "shop.v1.Money"},
	}

	for _, c := range cases {
		got := ix.resolveType("shop.v1", &c.field)
		if got.Written != c.written || got.FQN != c.fqn {
			t.Errorf("%s: %q -> %q (want %q -> %q)", c.field.Type, got.Written, got.FQN, c.written, c.fqn)
		}
	}
}

// The fragment is committed and compared by gen:check, so anything derived from
// a map has to come out in the same order every run.
func TestNamesAreSorted(t *testing.T) {
	names := indexed(t).Names()

	for i := 1; i < len(names); i++ {
		if names[i-1] > names[i] {
			t.Fatalf("names are not sorted: %q before %q", names[i-1], names[i])
		}
	}
	if len(names) == 0 {
		t.Fatal("nothing was indexed")
	}
}
