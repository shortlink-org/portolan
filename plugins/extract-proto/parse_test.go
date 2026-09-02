package main

// The parser, on its own. Nothing here knows the catalog exists: a proto is
// read into an AST, and whether that AST becomes a service or a message is
// somebody else's question.

import (
	"os"
	"strings"
	"testing"
)

func parseFile(t *testing.T, name string) (*File, []Note) {
	t.Helper()

	src, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	file, notes, err := Parse("testdata/"+name, string(src))
	if err != nil {
		t.Fatalf("parsing %s: %v", name, err)
	}

	return file, notes
}

func orders(t *testing.T) *File {
	t.Helper()
	file, notes := parseFile(t, "orders.proto")
	if len(notes) > 0 {
		t.Errorf("a well-formed proto3 file produced notes: %v", notes)
	}

	return file
}

func TestFileHeader(t *testing.T) {
	file := orders(t)

	if file.Syntax != "proto3" {
		t.Errorf("syntax: %q", file.Syntax)
	}
	if file.Package != "shop.v1" {
		t.Errorf("package: %q", file.Package)
	}
	if len(file.Imports) != 2 {
		t.Fatalf("imports: %v", file.Imports)
	}
	if file.Imports[0].Path != "shop/v1/money.proto" || file.Imports[0].Public {
		t.Errorf("plain import: %+v", file.Imports[0])
	}
	if !file.Imports[1].Public {
		t.Errorf("public import was not marked public: %+v", file.Imports[1])
	}
	if len(file.Options) != 1 || file.Options[0].Name != "go_package" {
		t.Errorf("options: %+v", file.Options)
	}
}

// All four streaming forms, because a bidi method drawn as unary is a lie about
// how the two ends are coupled.
func TestStreaming(t *testing.T) {
	svc := orders(t).Services[0]

	want := map[string][2]bool{
		"PlaceOrder":   {false, false},
		"GetOrder":     {false, false},
		"WatchOrder":   {false, true},
		"ImportOrders": {true, false},
		"Sync":         {true, true},
		"CancelOrder":  {false, false},
	}

	if len(svc.Methods) != len(want) {
		t.Fatalf("methods: %d, want %d", len(svc.Methods), len(want))
	}
	for _, m := range svc.Methods {
		got := [2]bool{m.ClientStreaming, m.ServerStreaming}
		if got != want[m.Name] {
			t.Errorf("%s streams %v, want %v", m.Name, got, want[m.Name])
		}
	}
}

func TestMethodShapes(t *testing.T) {
	svc := orders(t).Services[0]

	place := svc.Methods[0]
	if place.Request != "PlaceOrderRequest" || place.Response != "PlaceOrderResponse" {
		t.Errorf("PlaceOrder: %q -> %q", place.Request, place.Response)
	}
	watch := svc.Methods[2]
	if watch.Response != "OrderEvent" {
		t.Errorf("a streamed response must name the message, not the stream: %q", watch.Response)
	}
}

// A method option body must not swallow the methods after it.
func TestMethodOptionBody(t *testing.T) {
	svc := orders(t).Services[0]

	cancel := svc.Methods[5]
	if cancel.Name != "CancelOrder" {
		t.Fatalf("last method: %q", cancel.Name)
	}
	if !cancel.Deprecated {
		t.Error("a method with `option deprecated = true` is not marked deprecated")
	}
}

// Comments are the only documentation a proto carries, and they arrive three
// different ways.
func TestDocComments(t *testing.T) {
	file := orders(t)
	svc := file.Services[0]

	if !strings.HasPrefix(svc.Doc, "The order interface.") {
		t.Errorf("block comment above a service: %q", svc.Doc)
	}
	if svc.Methods[0].Doc != "Place a new order. The response carries the id the shop assigned." {
		t.Errorf("line comment above a method: %q", svc.Methods[0].Doc)
	}
	if svc.Methods[1].Doc != "Read one order back." {
		t.Errorf("trailing comment on a method: %q", svc.Methods[1].Doc)
	}

	place := messageNamed(t, file, "PlaceOrderRequest")
	if place.Fields[0].Doc != "Who is buying." {
		t.Errorf("comment above a field: %q", place.Fields[0].Doc)
	}
	// The field after a documented one must not inherit its comment.
	if place.Fields[1].Doc != "" {
		t.Errorf("an undocumented field borrowed a comment: %q", place.Fields[1].Doc)
	}
}

// Types are kept as written, because a reader comparing the page against the
// file it came from should recognise what they are looking at.
func TestFieldTypesAsWritten(t *testing.T) {
	place := messageNamed(t, orders(t), "PlaceOrderRequest")

	want := []struct{ name, typ, label string }{
		{"customer_id", "string", ""},
		{"items", "LineItem", "repeated"},
		{"coupon", "string", "optional"},
		{"metadata", "map<string, string>", ""},
		{"total", "Money", ""},
	}

	if len(place.Fields) != len(want) {
		t.Fatalf("fields: %d, want %d", len(place.Fields), len(want))
	}
	for i, w := range want {
		f := place.Fields[i]
		if f.Name != w.name || f.Type != w.typ || f.Label != w.label {
			t.Errorf("field %d: %s %s %s", i, f.Label, f.Type, f.Name)
		}
		if f.Number != i+1 {
			t.Errorf("%s is field %d, want %d", f.Name, f.Number, i+1)
		}
	}
	if len(place.Reserved) != 3 {
		t.Errorf("reserved: %v", place.Reserved)
	}
}

// A oneof constrains which field may be set; it is not a separate place a field
// lives. So its members are in the message's field list AND named by the oneof.
func TestOneofMembersAreFields(t *testing.T) {
	order := messageNamed(t, orders(t), "Order")

	if len(order.Oneofs) != 1 || order.Oneofs[0].Name != "settlement" {
		t.Fatalf("oneofs: %+v", order.Oneofs)
	}
	if len(order.Oneofs[0].Fields) != 2 {
		t.Fatalf("oneof members: %+v", order.Oneofs[0].Fields)
	}

	byName := map[string]*Field{}
	for _, f := range order.Fields {
		byName[f.Name] = f
	}
	if byName["paid"] == nil || byName["paid"].Oneof != "settlement" {
		t.Error("a oneof member is missing from the message's fields, or does not name its oneof")
	}
	if byName["ship_to"] == nil || byName["ship_to"].Oneof != "" {
		t.Error("a plain field claims to be in a oneof")
	}
	// The fields declared after the oneof must still be there.
	if byName["channel"] == nil {
		t.Error("a field declared after a oneof was swallowed")
	}
}

func TestNestedTypes(t *testing.T) {
	order := messageNamed(t, orders(t), "Order")

	if len(order.Messages) != 1 || order.Messages[0].Name != "Address" {
		t.Fatalf("nested messages: %+v", order.Messages)
	}
	if !order.Messages[0].Fields[1].Deprecated {
		t.Error("a field with [deprecated = true] is not marked deprecated")
	}
	if len(order.Enums) != 1 || order.Enums[0].Name != "Channel" {
		t.Fatalf("nested enums: %+v", order.Enums)
	}
}

func TestTopLevelEnum(t *testing.T) {
	file := orders(t)

	if len(file.Enums) != 1 {
		t.Fatalf("enums: %+v", file.Enums)
	}
	status := file.Enums[0]
	if status.Doc != "How far along an order is." {
		t.Errorf("enum doc: %q", status.Doc)
	}
	if len(status.Values) != 2 || status.Values[1].Number != 1 {
		t.Fatalf("values: %+v", status.Values)
	}
	if status.Values[1].Doc != "The shop has it." {
		t.Errorf("trailing comment on an enum value: %q", status.Values[1].Doc)
	}
}

// The tolerance rule: a construct the parser declines to model is NAMED and
// read past, never dropped silently and never fatal. A vendored copy that has
// been narrowed is the normal case, not the exception.
func TestSkippedConstructsAreNamed(t *testing.T) {
	file, notes := parseFile(t, "awkward.proto")

	joined := strings.Join(messages(notes), "\n")
	for _, want := range []string{"extend", "group", "extensions"} {
		if !strings.Contains(joined, want) {
			t.Errorf("%q was skipped without saying so:\n%s", want, joined)
		}
	}

	// Everything around the skipped constructs still has to be read.
	if len(file.Services) != 1 || len(file.Services[0].Methods) != 1 {
		t.Errorf("a service after an unreadable construct was lost: %+v", file.Services)
	}
	old := messageNamed(t, file, "Old")
	byName := map[string]*Field{}
	for _, f := range old.Fields {
		byName[f.Name] = f
	}
	if byName["name"] == nil || byName["name"].Label != "required" {
		t.Error("a proto2 required field was not read")
	}
	if byName["count"] == nil || byName["count"].Default != "3" {
		t.Errorf("a default value was not read: %+v", byName["count"])
	}
	if byName["kept"] == nil {
		t.Error("the field after a group was swallowed with it")
	}
}

// Past a truncated file the parser is not reading proto any more, it is
// guessing - so it says so rather than returning half a file.
func TestTruncatedFile(t *testing.T) {
	_, _, err := Parse("broken.proto", "message Foo {\n  string a = 1;\n  // and then\n")
	if err == nil {
		t.Skip("an unterminated block is recoverable; only an unterminated token is not")
	}
}

func TestUnterminatedStringIsAnError(t *testing.T) {
	_, _, err := Parse("broken.proto", "option go_package = \"never closed;\n")
	if err == nil {
		t.Fatal("an unterminated string parsed cleanly")
	}
	if !strings.Contains(err.Error(), "broken.proto") {
		t.Errorf("the error does not name the file: %v", err)
	}
}

func TestUnterminatedBlockCommentIsAnError(t *testing.T) {
	_, _, err := Parse("broken.proto", "/* never closed\nmessage Foo {}\n")
	if err == nil {
		t.Fatal("an unterminated block comment parsed cleanly")
	}
}

func messageNamed(t *testing.T, file *File, name string) *Message {
	t.Helper()

	for _, m := range file.Messages {
		if m.Name == name {
			return m
		}
	}
	t.Fatalf("no message %q", name)

	return nil
}

func messages(notes []Note) []string {
	out := make([]string, 0, len(notes))
	for _, n := range notes {
		out = append(out, n.Message)
	}

	return out
}
