package main

// The definitions of a schema, read straight out of the SDL.
//
// A GraphQL server has a runtime schema and can print it, but printing needs
// the server, and the whole point of reading source is that nothing has to be
// running. So this is a parser for the type system language only - no
// executable documents, no fragments, no queries - which is a much smaller
// grammar than it looks: a handful of definition keywords, fields with
// arguments, and the wrappers `!` and `[]`.
//
// The same type may be declared in several files. A modular schema says
// `type Query { basket(...): Basket }` in one module and `type Query { order(...)
// : Order }` in the next, and both of them mean the one Query the server
// serves. Declarations merge; the file each field came from is kept, because
// that is what says which module owns it.

import (
	"fmt"
	"sort"
	"strings"
)

type typeKind string

const (
	kindObject    typeKind = "type"
	kindInterface typeKind = "interface"
	kindInput     typeKind = "input"
	kindUnion     typeKind = "union"
	kindEnum      typeKind = "enum"
	kindScalar    typeKind = "scalar"
)

// typeRef is a type as a field writes it: a name at the bottom, and the
// wrappers around it. Nested lists collapse into one - a catalog that spelled
// `[][]Line` would be describing a shape no reader of this estate has.
type typeRef struct {
	name    string
	list    bool
	nonNull bool
}

// spell renders a type the way every other extractor here spells one: `[]Item`
// for a list, the bare name otherwise. Nullability is not spelled, it is said
// in the prose, the same way an optional OpenAPI property is.
func (t typeRef) spell() string {
	if t.list {
		return "[]" + t.name
	}

	return t.name
}

type argDef struct {
	name string
	doc  string
	typ  typeRef
}

type fieldDef struct {
	name string
	doc  string
	args []argDef
	typ  typeRef

	deprecated bool
	reason     string

	// file is the document this field was declared in, and module is what that
	// document is called for the purpose of grouping. A root field's module
	// decides which interface it lands in.
	file   string
	module string
}

type typeDef struct {
	kind   typeKind
	name   string
	doc    string
	fields []fieldDef

	// values are an enum's members, members a union's, and implements the
	// interfaces an object declares - which is the other way a schema says
	// "this shape stands for several".
	values     []string
	members    []string
	implements []string

	file   string
	module string
}

type document struct {
	types map[string]*typeDef
	order []string

	// roots are the operation types the schema declares, by operation. A
	// schema that says nothing has the three the spec names by default.
	roots map[string]string
}

func newDocument() *document {
	return &document{
		types: map[string]*typeDef{},
		roots: map[string]string{},
	}
}

func (d *document) root(operation string) string {
	if named, ok := d.roots[operation]; ok {
		return named
	}

	return strings.ToUpper(operation[:1]) + operation[1:]
}

func (d *document) define(t *typeDef) {
	existing, ok := d.types[t.name]
	if !ok {
		d.types[t.name] = t
		d.order = append(d.order, t.name)
		return
	}

	// The second declaration of a type extends the first, whether or not it
	// said `extend`. A field declared twice is the schema's problem, not this
	// reader's; the first spelling wins so the output does not depend on which
	// file happened to sort first.
	if existing.doc == "" {
		existing.doc = t.doc
	}
	for _, f := range t.fields {
		if existing.field(f.name) == nil {
			existing.fields = append(existing.fields, f)
		}
	}
	existing.values = append(existing.values, t.values...)
	existing.members = append(existing.members, t.members...)
	existing.implements = append(existing.implements, t.implements...)
}

func (t *typeDef) field(name string) *fieldDef {
	for i := range t.fields {
		if t.fields[i].name == name {
			return &t.fields[i]
		}
	}

	return nil
}

type parser struct {
	toks   []token
	pos    int
	file   string
	module string
	doc    *document
}

// parseInto reads one SDL file into a document that may already hold others.
func parseInto(d *document, src, file, module string) error {
	toks, err := lex(src)
	if err != nil {
		return fmt.Errorf("%s: %w", file, err)
	}

	p := &parser{toks: toks, file: file, module: module, doc: d}
	if err := p.document(); err != nil {
		return fmt.Errorf("%s: %w", file, err)
	}

	return nil
}

func (p *parser) peek() token      { return p.toks[p.pos] }
func (p *parser) next() token      { t := p.toks[p.pos]; p.pos++; return t }
func (p *parser) done() bool       { return p.peek().kind == tokEOF }
func (p *parser) at(s string) bool { return p.peek().is(s) }

func (p *parser) accept(s string) bool {
	if p.at(s) {
		p.pos++
		return true
	}

	return false
}

func (p *parser) expect(s string) error {
	if p.accept(s) {
		return nil
	}
	tok := p.peek()

	return fmt.Errorf("line %d: expected %q, found %q", tok.line, s, tok.text)
}

func (p *parser) name() (string, error) {
	tok := p.peek()
	if tok.kind != tokName {
		return "", fmt.Errorf("line %d: expected a name, found %q", tok.line, tok.text)
	}
	p.pos++

	return tok.text, nil
}

func (p *parser) document() error {
	for !p.done() {
		doc := ""
		if p.peek().kind == tokString {
			doc = p.next().text
		}
		if err := p.definition(doc); err != nil {
			return err
		}
	}

	return nil
}

func (p *parser) definition(doc string) error {
	// `extend` says the definition adds to one that already exists, which is
	// what merging does anyway.
	p.accept("extend")

	keyword := p.peek()
	if keyword.kind != tokName {
		return fmt.Errorf("line %d: expected a definition, found %q", keyword.line, keyword.text)
	}
	p.pos++

	switch keyword.text {
	case "schema":
		return p.schema()
	case "type", "interface", "input":
		return p.object(typeKind(keyword.text), doc)
	case "union":
		return p.union(doc)
	case "enum":
		return p.enum(doc)
	case "scalar":
		return p.scalar(doc)
	case "directive":
		return p.directiveDefinition()
	}

	return fmt.Errorf("line %d: %q is not a type system definition", keyword.line, keyword.text)
}

func (p *parser) schema() error {
	if err := p.directives(nil); err != nil {
		return err
	}
	if err := p.expect("{"); err != nil {
		return err
	}
	for !p.accept("}") {
		operation, err := p.name()
		if err != nil {
			return err
		}
		if err := p.expect(":"); err != nil {
			return err
		}
		named, err := p.name()
		if err != nil {
			return err
		}
		p.doc.roots[operation] = named
	}

	return nil
}

func (p *parser) object(kind typeKind, doc string) error {
	name, err := p.name()
	if err != nil {
		return err
	}

	var implements []string
	if p.accept("implements") {
		p.accept("&")
		for {
			iface, err := p.name()
			if err != nil {
				return err
			}
			implements = append(implements, iface)
			if !p.accept("&") {
				break
			}
		}
	}
	if err := p.directives(nil); err != nil {
		return err
	}

	t := &typeDef{kind: kind, name: name, doc: doc, implements: implements, file: p.file, module: p.module}
	if p.accept("{") {
		for !p.accept("}") {
			field, err := p.field()
			if err != nil {
				return err
			}
			t.fields = append(t.fields, field)
		}
	}
	p.doc.define(t)

	return nil
}

func (p *parser) field() (fieldDef, error) {
	f := fieldDef{file: p.file, module: p.module}
	if p.peek().kind == tokString {
		f.doc = p.next().text
	}

	name, err := p.name()
	if err != nil {
		return f, err
	}
	f.name = name

	if p.accept("(") {
		for !p.accept(")") {
			arg, err := p.argument()
			if err != nil {
				return f, err
			}
			f.args = append(f.args, arg)
		}
	}

	if err := p.expect(":"); err != nil {
		return f, err
	}
	if f.typ, err = p.typeRef(); err != nil {
		return f, err
	}

	// An input field may carry a default; an output field may not, and a
	// document that gives one is wrong in a way this reader does not need to
	// care about.
	if p.accept("=") {
		if err := p.value(); err != nil {
			return f, err
		}
	}

	deprecated := &f
	if err := p.directives(deprecated); err != nil {
		return f, err
	}

	return f, nil
}

func (p *parser) argument() (argDef, error) {
	a := argDef{}
	if p.peek().kind == tokString {
		a.doc = p.next().text
	}

	name, err := p.name()
	if err != nil {
		return a, err
	}
	a.name = name

	if err := p.expect(":"); err != nil {
		return a, err
	}
	if a.typ, err = p.typeRef(); err != nil {
		return a, err
	}
	if p.accept("=") {
		if err := p.value(); err != nil {
			return a, err
		}
	}

	return a, p.directives(nil)
}

func (p *parser) typeRef() (typeRef, error) {
	var t typeRef
	if p.accept("[") {
		inner, err := p.typeRef()
		if err != nil {
			return t, err
		}
		if err := p.expect("]"); err != nil {
			return t, err
		}
		t = typeRef{name: inner.name, list: true}
	} else {
		name, err := p.name()
		if err != nil {
			return t, err
		}
		t = typeRef{name: name}
	}
	t.nonNull = p.accept("!")

	return t, nil
}

func (p *parser) union(doc string) error {
	name, err := p.name()
	if err != nil {
		return err
	}
	if err := p.directives(nil); err != nil {
		return err
	}

	t := &typeDef{kind: kindUnion, name: name, doc: doc, file: p.file, module: p.module}
	if p.accept("=") {
		p.accept("|")
		for {
			member, err := p.name()
			if err != nil {
				return err
			}
			t.members = append(t.members, member)
			if !p.accept("|") {
				break
			}
		}
	}
	p.doc.define(t)

	return nil
}

func (p *parser) enum(doc string) error {
	name, err := p.name()
	if err != nil {
		return err
	}
	if err := p.directives(nil); err != nil {
		return err
	}

	t := &typeDef{kind: kindEnum, name: name, doc: doc, file: p.file, module: p.module}
	if p.accept("{") {
		for !p.accept("}") {
			if p.peek().kind == tokString {
				p.pos++
			}
			value, err := p.name()
			if err != nil {
				return err
			}
			if err := p.directives(nil); err != nil {
				return err
			}
			t.values = append(t.values, value)
		}
	}
	p.doc.define(t)

	return nil
}

func (p *parser) scalar(doc string) error {
	name, err := p.name()
	if err != nil {
		return err
	}
	if err := p.directives(nil); err != nil {
		return err
	}
	p.doc.define(&typeDef{kind: kindScalar, name: name, doc: doc, file: p.file, module: p.module})

	return nil
}

// directiveDefinition is stepped over. A schema may define its own directives;
// none of them are facts about the estate.
func (p *parser) directiveDefinition() error {
	if err := p.expect("@"); err != nil {
		return err
	}
	if _, err := p.name(); err != nil {
		return err
	}
	if p.accept("(") {
		for !p.accept(")") {
			if _, err := p.argument(); err != nil {
				return err
			}
		}
	}
	p.accept("repeatable")
	if err := p.expect("on"); err != nil {
		return err
	}
	p.accept("|")
	for {
		if _, err := p.name(); err != nil {
			return err
		}
		if !p.accept("|") {
			break
		}
	}

	return nil
}

// directives reads the directives on a declaration. Only one of them says
// something the catalog holds - `@deprecated`, which every other extractor
// here also reports - so only that one is kept, and onto the field that
// carries it.
func (p *parser) directives(f *fieldDef) error {
	for p.accept("@") {
		name, err := p.name()
		if err != nil {
			return err
		}

		reason := ""
		if p.accept("(") {
			for !p.accept(")") {
				argName, err := p.name()
				if err != nil {
					return err
				}
				if err := p.expect(":"); err != nil {
					return err
				}
				start := p.pos
				if err := p.value(); err != nil {
					return err
				}
				if argName == "reason" && p.toks[start].kind == tokString {
					reason = p.toks[start].text
				}
			}
		}

		if name == "deprecated" && f != nil {
			f.deprecated = true
			f.reason = reason
		}
	}

	return nil
}

// value steps over a literal. Defaults and directive arguments are read only
// far enough to get past them, apart from a deprecation reason.
func (p *parser) value() error {
	tok := p.peek()
	switch {
	case tok.is("["):
		p.pos++
		for !p.accept("]") {
			if p.done() {
				return fmt.Errorf("line %d: a list value is never closed", tok.line)
			}
			if err := p.value(); err != nil {
				return err
			}
		}
		return nil
	case tok.is("{"):
		p.pos++
		for !p.accept("}") {
			if p.done() {
				return fmt.Errorf("line %d: an object value is never closed", tok.line)
			}
			if _, err := p.name(); err != nil {
				return err
			}
			if err := p.expect(":"); err != nil {
				return err
			}
			if err := p.value(); err != nil {
				return err
			}
		}
		return nil
	case tok.is("$"):
		p.pos++
		_, err := p.name()
		return err
	case tok.kind == tokName, tok.kind == tokString, tok.kind == tokNumber:
		p.pos++
		return nil
	}

	return fmt.Errorf("line %d: %q is not a value", tok.line, tok.text)
}

// modules are every module that declared something, in a stable order.
func (d *document) modules() []string {
	seen := map[string]bool{}
	var out []string
	for _, name := range d.order {
		t := d.types[name]
		if !seen[t.module] {
			seen[t.module] = true
			out = append(out, t.module)
		}
		for _, f := range t.fields {
			if !seen[f.module] {
				seen[f.module] = true
				out = append(out, f.module)
			}
		}
	}
	sort.Strings(out)

	return out
}
