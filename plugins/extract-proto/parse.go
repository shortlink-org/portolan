package main

// A tolerant recursive-descent parser for .proto.
//
// TOLERANT is the whole design, not a shortcut. docs/adr/org.0001.md has
// consumers keeping NARROWED vendored copies - "a consumer may narrow a message
// to the fields it actually uses" - and a narrowed copy routinely imports a file
// that was not vendored beside it. A compiler refuses to produce anything for
// that input; the point of reading vendored copies is to describe files that do
// not build standalone. So an unrecognised construct is skipped to the end of
// its block and NAMED in a Note, never dropped and never fatal.
//
// The two things that are fatal are a file that cannot be tokenised and a file
// that ends mid-declaration, because past either of those the parser is not
// reading proto any more, it is guessing.

import (
	"fmt"
	"strconv"
	"strings"
)

type parser struct {
	toks  []token
	at    int
	path  string
	notes []Note
}

// Parse reads one .proto. The returned notes name every construct it declined
// to model; an error means the file could not be read at all.
func Parse(path, src string) (*File, []Note, error) {
	out, err := lex(src)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", path, err)
	}

	p := &parser{toks: out.tokens, path: path}
	file := &File{Path: path, Doc: p.peek().doc}

	for !p.done() {
		if p.peek().is(";") { // a stray semicolon between declarations is legal
			p.take()

			continue
		}

		tok := p.peek()
		if tok.kind != tokIdent {
			p.note(tok.line, fmt.Sprintf("unexpected %q at the top level; skipped", tok.text))
			p.skipDeclaration()

			continue
		}

		switch tok.text {
		case "syntax", "edition":
			p.take()
			if !p.expect("=") {
				continue
			}
			if v := p.take(); v.kind == tokString {
				file.Syntax = v.text
			}
			p.expect(";")
		case "package":
			p.take()
			file.Package = p.qualified()
			p.expect(";")
		case "import":
			file.Imports = append(file.Imports, p.parseImport())
		case "option":
			if o, ok := p.parseOption(); ok {
				file.Options = append(file.Options, o)
			}
		case "message":
			if m := p.parseMessage(); m != nil {
				file.Messages = append(file.Messages, m)
			}
		case "enum":
			if e := p.parseEnum(); e != nil {
				file.Enums = append(file.Enums, e)
			}
		case "service":
			if s := p.parseService(); s != nil {
				file.Services = append(file.Services, s)
			}
		case "extend":
			// Modelled by nothing in the catalog: an extension adds fields to
			// someone else's message, and the catalog has no way to say that.
			p.note(tok.line, "extend is not read; the fields it adds are not listed")
			p.take()
			p.qualified()
			p.skipBlock()
		default:
			p.note(tok.line, fmt.Sprintf("%q is not a declaration this parser reads; skipped", tok.text))
			p.skipDeclaration()
		}
	}

	// Trailing comments are attached last, by line, so a field documented to
	// its right reads the same as one documented above.
	attachTrailing(file, out.trailing)

	return file, p.notes, nil
}

func (p *parser) parseImport() Import {
	tok := p.take() // "import"
	imp := Import{Line: tok.line}
	switch {
	case p.peek().is("public"):
		p.take()
		imp.Public = true
	case p.peek().is("weak"):
		p.take()
		imp.Weak = true
	}
	if v := p.peek(); v.kind == tokString {
		imp.Path = p.take().text
	}
	p.expect(";")

	return imp
}

func (p *parser) parseOption() (Option, bool) {
	tok := p.take() // "option"
	name := p.optionName()
	if !p.expect("=") {
		return Option{}, false
	}
	value := p.optionValue()
	p.expect(";")

	return Option{Name: name, Value: value, Line: tok.line}, true
}

// optionName reads a name that may be parenthesised and dotted:
// `go_package`, `(google.api.http).post`.
func (p *parser) optionName() string {
	var b strings.Builder
	for {
		switch {
		case p.peek().is("("):
			p.take()
			b.WriteString("(")
			b.WriteString(p.qualified())
			if p.peek().is(")") {
				p.take()
			}
			b.WriteString(")")
		case p.peek().kind == tokIdent:
			b.WriteString(p.take().text)
		case p.peek().is("."):
			p.take()
			b.WriteString(".")
		default:
			return b.String()
		}
		if !p.peek().is(".") {
			return b.String()
		}
	}
}

// optionValue reads a scalar value, or skips an aggregate `{ ... }` body.
func (p *parser) optionValue() string {
	tok := p.peek()
	if tok.is("{") {
		// A custom option body is arbitrary and modelled by nothing here.
		p.note(tok.line, "an aggregate option value is not read")
		p.skipBlock()

		return ""
	}
	if tok.is("[") {
		p.skipBrackets()

		return ""
	}

	var b strings.Builder
	for !p.done() && !p.peek().is(";") && !p.peek().is(",") && !p.peek().is("]") {
		t := p.take()
		if t.kind == tokString {
			b.WriteString(t.text)

			continue
		}
		b.WriteString(t.text)
	}

	return b.String()
}

func (p *parser) parseMessage() *Message {
	tok := p.take() // "message"
	name := p.take()
	if name.kind != tokIdent {
		p.note(tok.line, "message has no name; skipped")
		p.skipDeclaration()

		return nil
	}

	msg := &Message{Name: name.text, Doc: tok.doc, Line: tok.line}
	if !p.expect("{") {
		return msg
	}
	p.messageBody(msg, "")

	return msg
}

// messageBody reads declarations up to the closing brace, which it consumes.
// oneof is the name of the oneof enclosing these fields, empty at the top.
func (p *parser) messageBody(msg *Message, oneof string) {
	for !p.done() && !p.peek().is("}") {
		tok := p.peek()

		if tok.is(";") {
			p.take()

			continue
		}

		if tok.kind != tokIdent {
			p.note(tok.line, fmt.Sprintf("unexpected %q in message %q; skipped", tok.text, msg.Name))
			p.skipDeclaration()

			continue
		}

		switch tok.text {
		case "message":
			if nested := p.parseMessage(); nested != nil {
				msg.Messages = append(msg.Messages, nested)
			}
		case "enum":
			if e := p.parseEnum(); e != nil {
				msg.Enums = append(msg.Enums, e)
			}
		case "option":
			p.parseOption()
		case "reserved":
			msg.Reserved = append(msg.Reserved, p.parseReserved()...)
		case "extensions":
			p.note(tok.line, "extensions ranges are not read")
			p.skipDeclaration()
		case "extend":
			p.note(tok.line, "extend is not read; the fields it adds are not listed")
			p.take()
			p.qualified()
			p.skipBlock()
		case "oneof":
			p.parseOneof(msg)
		case "group":
			p.note(tok.line, "a proto2 group is not read; its fields are not listed")
			p.skipDeclaration()
		default:
			if f := p.parseField(oneof); f != nil {
				msg.Fields = append(msg.Fields, f)
			}
		}
	}
	p.expect("}")
}

func (p *parser) parseOneof(msg *Message) {
	tok := p.take() // "oneof"
	name := p.take()
	if name.kind != tokIdent {
		p.note(tok.line, "oneof has no name; skipped")
		p.skipDeclaration()

		return
	}
	one := &Oneof{Name: name.text, Doc: tok.doc, Line: tok.line}
	if !p.expect("{") {
		return
	}

	// A oneof body is a message body with one field kind excluded, and reusing
	// the same reader is what keeps a oneof member and a plain field the same
	// shape - which is the whole reason `Message.Fields` holds both.
	before := len(msg.Fields)
	p.messageBody(msg, one.Name)
	one.Fields = append(one.Fields, msg.Fields[before:]...)
	msg.Oneofs = append(msg.Oneofs, one)
}

func (p *parser) parseField(oneof string) *Field {
	tok := p.peek()
	f := &Field{Doc: tok.doc, Line: tok.line, Oneof: oneof}

	switch tok.text {
	case "repeated", "optional", "required":
		f.Label = p.take().text
	}

	if p.peek().is("group") {
		p.note(p.peek().line, "a proto2 group is not read; its fields are not listed")
		p.skipDeclaration()

		return nil
	}

	f.Type = p.typeName()
	if f.Type == "" {
		p.note(tok.line, "a field with no type; skipped")
		p.skipDeclaration()

		return nil
	}

	name := p.take()
	if name.kind != tokIdent {
		p.note(tok.line, fmt.Sprintf("a %s field with no name; skipped", f.Type))
		p.skipDeclaration()

		return nil
	}
	f.Name = name.text

	if p.expect("=") {
		if n := p.take(); n.kind == tokNumber {
			f.Number, _ = strconv.Atoi(n.text)
		}
	}

	if p.peek().is("[") {
		p.fieldOptions(f)
	}
	p.expect(";")

	return f
}

// fieldOptions reads `[deprecated = true, default = "x"]`. Only the two the
// catalog can say anything about are kept; the rest are read past so they
// cannot desynchronise the parser.
func (p *parser) fieldOptions(f *Field) {
	p.take() // "["
	for !p.done() && !p.peek().is("]") {
		name := p.optionName()
		if !p.expect("=") {
			break
		}
		value := p.optionValue()
		switch name {
		case "deprecated":
			f.Deprecated = value == "true"
		case "default":
			f.Default = value
		}
		if p.peek().is(",") {
			p.take()
		}
	}
	p.expect("]")
}

func (p *parser) parseReserved() []string {
	p.take() // "reserved"
	var out []string
	for !p.done() && !p.peek().is(";") {
		t := p.take()
		if t.kind == tokString || t.kind == tokNumber {
			out = append(out, t.text)
		}
	}
	p.expect(";")

	return out
}

func (p *parser) parseEnum() *Enum {
	tok := p.take() // "enum"
	name := p.take()
	if name.kind != tokIdent {
		p.note(tok.line, "enum has no name; skipped")
		p.skipDeclaration()

		return nil
	}

	e := &Enum{Name: name.text, Doc: tok.doc, Line: tok.line}
	if !p.expect("{") {
		return e
	}

	for !p.done() && !p.peek().is("}") {
		t := p.peek()
		if t.is(";") {
			p.take()

			continue
		}
		if t.is("option") {
			p.parseOption()

			continue
		}
		if t.is("reserved") {
			p.parseReserved()

			continue
		}
		if t.kind != tokIdent {
			p.note(t.line, fmt.Sprintf("unexpected %q in enum %q; skipped", t.text, e.Name))
			p.skipDeclaration()

			continue
		}

		value := &EnumValue{Name: p.take().text, Doc: t.doc, Line: t.line}
		if p.expect("=") {
			if n := p.take(); n.kind == tokNumber {
				value.Number, _ = strconv.Atoi(n.text)
			}
		}
		if p.peek().is("[") {
			p.skipBrackets()
		}
		p.expect(";")
		e.Values = append(e.Values, value)
	}
	p.expect("}")

	return e
}

func (p *parser) parseService() *Service {
	tok := p.take() // "service"
	name := p.take()
	if name.kind != tokIdent {
		p.note(tok.line, "service has no name; skipped")
		p.skipDeclaration()

		return nil
	}

	svc := &Service{Name: name.text, Doc: tok.doc, Line: tok.line}
	if !p.expect("{") {
		return svc
	}

	for !p.done() && !p.peek().is("}") {
		t := p.peek()
		switch {
		case t.is(";"):
			p.take()
		case t.is("option"):
			p.parseOption()
		case t.is("rpc"):
			if m := p.parseMethod(); m != nil {
				svc.Methods = append(svc.Methods, m)
			}
		default:
			p.note(t.line, fmt.Sprintf("unexpected %q in service %q; skipped", t.text, svc.Name))
			p.skipDeclaration()
		}
	}
	p.expect("}")

	return svc
}

func (p *parser) parseMethod() *Method {
	tok := p.take() // "rpc"
	name := p.take()
	if name.kind != tokIdent {
		p.note(tok.line, "rpc has no name; skipped")
		p.skipDeclaration()

		return nil
	}

	m := &Method{Name: name.text, Doc: tok.doc, Line: tok.line}
	m.ClientStreaming, m.Request = p.methodType()
	if !p.peek().is("returns") {
		p.note(tok.line, fmt.Sprintf("rpc %q has no returns clause; response unknown", m.Name))
	} else {
		p.take()
	}
	m.ServerStreaming, m.Response = p.methodType()

	// The body, when there is one, holds method options - `deprecated` being
	// the only one the catalog can carry.
	if p.peek().is("{") {
		p.take()
		for !p.done() && !p.peek().is("}") {
			if p.peek().is("option") {
				o, ok := p.parseOption()
				if ok && o.Name == "deprecated" && o.Value == "true" {
					m.Deprecated = true
				}

				continue
			}
			p.take()
		}
		p.expect("}")
	} else {
		p.expect(";")
	}

	return m
}

// methodType reads `(stream shop.v1.Req)` and says whether it streamed.
func (p *parser) methodType() (bool, string) {
	if !p.expect("(") {
		return false, ""
	}
	stream := false
	if p.peek().is("stream") {
		p.take()
		stream = true
	}
	name := p.qualified()
	p.expect(")")

	return stream, name
}

// typeName reads a field's type as written, including a map's two arguments.
func (p *parser) typeName() string {
	if p.peek().is("map") {
		p.take()
		if !p.peek().is("<") {
			return "map"
		}
		p.take()
		key := p.qualified()
		p.expect(",")
		value := p.typeName()
		p.expect(">")

		return "map<" + key + ", " + value + ">"
	}

	return p.qualified()
}

// qualified reads `shop.v1.Money`, or `.shop.v1.Money` with its leading dot
// kept - proto's spelling for "this is absolute, do not search enclosing
// scopes", which the resolver needs and a reader recognises.
func (p *parser) qualified() string {
	var b strings.Builder
	if p.peek().is(".") {
		p.take()
		b.WriteString(".")
	}
	if p.peek().kind != tokIdent {
		return b.String()
	}
	b.WriteString(p.take().text)
	for p.peek().is(".") {
		p.take()
		b.WriteString(".")
		if p.peek().kind != tokIdent {
			break
		}
		b.WriteString(p.take().text)
	}

	return b.String()
}

// --- the tolerance machinery -----------------------------------------------

func (p *parser) done() bool { return p.peek().kind == tokEOF }

func (p *parser) peek() token {
	if p.at >= len(p.toks) {
		return token{kind: tokEOF}
	}

	return p.toks[p.at]
}

func (p *parser) take() token {
	t := p.peek()
	if p.at < len(p.toks) {
		p.at++
	}

	return t
}

func (p *parser) expect(text string) bool {
	if p.peek().is(text) {
		p.take()

		return true
	}
	p.note(p.peek().line, fmt.Sprintf("expected %q, found %q", text, p.peek().text))

	return false
}

// skipDeclaration reads past whatever is here: to the semicolon that ends it,
// or past the balanced block it opens, whichever comes first.
func (p *parser) skipDeclaration() {
	for !p.done() {
		switch {
		case p.peek().is(";"):
			p.take()

			return
		case p.peek().is("{"):
			p.skipBlock()

			return
		case p.peek().is("}"):
			return
		default:
			p.take()
		}
	}
}

func (p *parser) skipBlock() {
	if !p.peek().is("{") {
		return
	}
	depth := 0
	for !p.done() {
		switch {
		case p.peek().is("{"):
			depth++
		case p.peek().is("}"):
			depth--
		}
		p.take()
		if depth == 0 {
			return
		}
	}
}

func (p *parser) skipBrackets() {
	if !p.peek().is("[") {
		return
	}
	depth := 0
	for !p.done() {
		switch {
		case p.peek().is("["):
			depth++
		case p.peek().is("]"):
			depth--
		}
		p.take()
		if depth == 0 {
			return
		}
	}
}

func (p *parser) note(line int, message string) {
	p.notes = append(p.notes, Note{Line: line, Message: message})
}

// attachTrailing gives a declaration the comment sitting at the end of its
// line, when nothing was written above it. Above wins: an author who wrote
// both meant the block as the documentation and the trailing note as an aside.
func attachTrailing(file *File, trailing map[int]string) {
	if len(trailing) == 0 {
		return
	}

	var doMessage func(m *Message)
	doMessage = func(m *Message) {
		if m.Doc == "" {
			m.Doc = trailing[m.Line]
		}
		for _, f := range m.Fields {
			if f.Doc == "" {
				f.Doc = trailing[f.Line]
			}
		}
		for _, e := range m.Enums {
			doEnum(e, trailing)
		}
		for _, nested := range m.Messages {
			doMessage(nested)
		}
	}

	for _, m := range file.Messages {
		doMessage(m)
	}
	for _, e := range file.Enums {
		doEnum(e, trailing)
	}
	for _, s := range file.Services {
		if s.Doc == "" {
			s.Doc = trailing[s.Line]
		}
		for _, m := range s.Methods {
			if m.Doc == "" {
				m.Doc = trailing[m.Line]
			}
		}
	}
}

func doEnum(e *Enum, trailing map[int]string) {
	if e.Doc == "" {
		e.Doc = trailing[e.Line]
	}
	for _, v := range e.Values {
		if v.Doc == "" {
			v.Doc = trailing[v.Line]
		}
	}
}
