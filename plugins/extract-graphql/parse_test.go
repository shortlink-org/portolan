package main

import "testing"

func parse(t *testing.T, src string) *document {
	t.Helper()

	d := newDocument()
	if err := parseInto(d, src, "schema.graphql", "storefront"); err != nil {
		t.Fatal(err)
	}

	return d
}

// A block string is prose written in a file with indentation, and the
// indentation is the file's, not the prose's.
func TestBlockStringLosesTheFilesIndentation(t *testing.T) {
	d := parse(t, `
type Query {
  """
  The basket this session is filling.

  Empty until something is put in it.
  """
  basket: Basket
}
`)

	got := d.types["Query"].fields[0].doc
	want := "The basket this session is filling.\n\nEmpty until something is put in it."
	if got != want {
		t.Errorf("description is %q, want %q", got, want)
	}
}

// A comment is not a description. Every GraphQL client throws `#` away, and a
// catalog that showed it would be showing a note the schema's readers cannot
// see.
func TestCommentsAreNotDescriptions(t *testing.T) {
	d := parse(t, `
type Query {
  # not documentation
  basket: Basket
}
`)

	if doc := d.types["Query"].fields[0].doc; doc != "" {
		t.Errorf("comment became the description %q", doc)
	}
}

// One Query, declared by every module that adds to it. Whether a module says
// `extend` is a matter of taste in tooling, and both spellings mean the one
// type the server serves.
func TestDeclarationsMerge(t *testing.T) {
	d := newDocument()
	if err := parseInto(d, "type Query { basket: Basket }", "basket/schema.graphql", "basket"); err != nil {
		t.Fatal(err)
	}
	if err := parseInto(d, "extend type Query { order: Order }", "order/schema.graphql", "order"); err != nil {
		t.Fatal(err)
	}

	fields := d.types["Query"].fields
	if len(fields) != 2 {
		t.Fatalf("Query has %d fields, want 2", len(fields))
	}
	if fields[0].module != "basket" || fields[1].module != "order" {
		t.Errorf("fields came from %q and %q, want basket and order", fields[0].module, fields[1].module)
	}
}

// The root types are named by the schema when it says so, and by the spec when
// it does not.
func TestSchemaDefinitionRenamesTheRoots(t *testing.T) {
	d := parse(t, "schema { query: RootQuery }\ntype RootQuery { basket: Basket }")

	if got := d.root("query"); got != "RootQuery" {
		t.Errorf("query root is %q, want RootQuery", got)
	}
	if got := d.root("mutation"); got != "Mutation" {
		t.Errorf("mutation root is %q, want Mutation", got)
	}
}

// Wrappers, defaults, directives and the argument list all have to be stepped
// over without losing the type at the bottom of them.
func TestTypesAndDefaults(t *testing.T) {
	d := parse(t, `
type Query {
  lines(first: Int = 20, filter: [String!] = ["a", "b"], where: LineFilter = {sku: "x"}): [Line!]! @cost(weight: 3)
}
`)

	field := d.types["Query"].fields[0]
	if !field.typ.list || field.typ.name != "Line" || !field.typ.nonNull {
		t.Errorf("field type read as %+v, want a non-null list of Line", field.typ)
	}
	if len(field.args) != 3 {
		t.Fatalf("read %d arguments, want 3", len(field.args))
	}
	if field.deprecated {
		t.Error("a @cost directive marked the field deprecated")
	}
}

func TestDeprecationCarriesItsReason(t *testing.T) {
	d := parse(t, `type Query { old: Basket @deprecated(reason: "Ask for `+"`basket`"+` instead.") }`)

	field := d.types["Query"].fields[0]
	if !field.deprecated || field.reason != "Ask for `basket` instead." {
		t.Errorf("read %+v, want a deprecation with its reason", field)
	}
}

func TestUnclosedStringIsAnError(t *testing.T) {
	d := newDocument()
	if err := parseInto(d, `type Query { "unclosed`, "schema.graphql", ""); err == nil {
		t.Error("an unterminated description parsed without complaint")
	}
}
