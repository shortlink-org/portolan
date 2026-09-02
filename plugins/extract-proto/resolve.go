package main

// Turning a name as written into the thing it names.
//
// A proto reference is relative to where it was written: `Money` inside
// `shop.v1.Order` might mean `shop.v1.Order.Money`, `shop.v1.Money`, or
// `Money` at the root, and proto searches outwards in that order. A leading dot
// means the search is skipped and the name is already absolute.
//
// A name that resolves to nothing is NOT an error here. A narrowed vendored
// copy importing a file nobody vendored beside it is the normal case - see the
// header of parse.go - and the answer is to say the type is unresolved and
// carry on, not to refuse to describe the file.

import (
	"sort"
	"strings"
)

// scalars are proto's built-in types, which never resolve to a declaration.
var scalars = map[string]bool{
	"double": true, "float": true, "int32": true, "int64": true,
	"uint32": true, "uint64": true, "sint32": true, "sint64": true,
	"fixed32": true, "fixed64": true, "sfixed32": true, "sfixed64": true,
	"bool": true, "string": true, "bytes": true,
}

func isScalar(name string) bool { return scalars[name] }

// Index is every declaration in a set of files, by fully-qualified name.
type Index struct {
	files []*File

	messages map[string]*Message
	enums    map[string]*Enum
	fileOf   map[string]*File
	fqnOf    map[*Message]string
}

// NewIndex walks the files once and records every message and enum in them,
// nested ones included, under the name the rest of the world would use.
func NewIndex(files []*File) *Index {
	ix := &Index{
		files:    files,
		messages: map[string]*Message{},
		enums:    map[string]*Enum{},
		fileOf:   map[string]*File{},
		fqnOf:    map[*Message]string{},
	}

	for _, file := range files {
		for _, m := range file.Messages {
			ix.addMessage(file, file.Package, m)
		}
		for _, e := range file.Enums {
			ix.addEnum(file, join(file.Package, e.Name), e)
		}
	}

	return ix
}

func (ix *Index) addMessage(file *File, scope string, m *Message) {
	fqn := join(scope, m.Name)
	ix.messages[fqn] = m
	ix.fileOf[fqn] = file
	ix.fqnOf[m] = fqn

	for _, nested := range m.Messages {
		ix.addMessage(file, fqn, nested)
	}
	for _, e := range m.Enums {
		ix.addEnum(file, join(fqn, e.Name), e)
	}
}

func (ix *Index) addEnum(file *File, fqn string, e *Enum) {
	ix.enums[fqn] = e
	ix.fileOf[fqn] = file
}

// Resolve finds what `name`, written inside `scope`, refers to.
//
// scope is a fully-qualified name - a package, or a message inside one. The
// search walks outwards from it, which is what proto itself does.
func (ix *Index) Resolve(scope, name string) (string, bool) {
	if name == "" || isScalar(name) {
		return "", false
	}

	if strings.HasPrefix(name, ".") {
		fqn := strings.TrimPrefix(name, ".")

		return fqn, ix.declared(fqn)
	}

	parts := strings.Split(scope, ".")
	for i := len(parts); i >= 0; i-- {
		fqn := join(strings.Join(parts[:i], "."), name)
		if ix.declared(fqn) {
			return fqn, true
		}
	}

	return "", false
}

func (ix *Index) declared(fqn string) bool {
	_, message := ix.messages[fqn]
	_, enum := ix.enums[fqn]

	return message || enum
}

func (ix *Index) Message(fqn string) *Message { return ix.messages[fqn] }
func (ix *Index) Enum(fqn string) *Enum       { return ix.enums[fqn] }
func (ix *Index) FileOf(fqn string) *File     { return ix.fileOf[fqn] }

// FQN is the name a message is known by, once it has been indexed.
func (ix *Index) FQN(m *Message) string { return ix.fqnOf[m] }

// Names is every declared name, sorted. Determinism is not a nicety here: the
// fragment these end up in is committed and compared by `gen:check`, so a map
// iterated in Go's order would produce a different file every run.
func (ix *Index) Names() []string {
	out := make([]string, 0, len(ix.messages)+len(ix.enums))
	for fqn := range ix.messages {
		out = append(out, fqn)
	}
	for fqn := range ix.enums {
		out = append(out, fqn)
	}
	sort.Strings(out)

	return out
}

// TypeRef is one field's type, resolved as far as it could be.
type TypeRef struct {
	// Written is the type as the author typed it, rendered the way the catalog
	// renders types: `[]LineItem`, `map[string]Money`, `Money`.
	Written string

	// FQN is what the named type resolves to, empty for a scalar or for a name
	// nothing in the tree declares.
	FQN string

	// Unresolved is the name that could not be found, empty when there was
	// nothing to find or the search succeeded. It is a diagnostic, not a
	// failure: a narrowed vendored copy is expected to have some.
	Unresolved string
}

// resolveType renders a field's type and resolves the name inside it.
//
// A map is rendered `map[K]V` and resolved on its value: the key of a proto map
// is always a scalar, and the value is the half that can name a message.
func (ix *Index) resolveType(scope string, f *Field) TypeRef {
	if key, value, ok := mapParts(f.Type); ok {
		inner := ix.resolveType(scope, &Field{Type: value})

		return TypeRef{
			Written:    "map[" + key + "]" + inner.Written,
			FQN:        inner.FQN,
			Unresolved: inner.Unresolved,
		}
	}

	ref := TypeRef{Written: shortName(f.Type)}
	if f.Label == "repeated" {
		ref.Written = "[]" + ref.Written
	}

	if isScalar(f.Type) {
		return ref
	}

	if fqn, ok := ix.Resolve(scope, f.Type); ok {
		ref.FQN = fqn
	} else {
		ref.Unresolved = f.Type
	}

	return ref
}

// mapParts splits `map<string, Money>` into its two arguments.
func mapParts(typ string) (string, string, bool) {
	if !strings.HasPrefix(typ, "map<") || !strings.HasSuffix(typ, ">") {
		return "", "", false
	}
	inner := typ[len("map<") : len(typ)-1]
	comma := strings.Index(inner, ",")
	if comma < 0 {
		return "", "", false
	}

	return strings.TrimSpace(inner[:comma]), strings.TrimSpace(inner[comma+1:]), true
}

// shortName is the last segment of a dotted name.
//
// The catalog spells a type the way a reader says it - `Money`, not
// `shop.v1.Money` - and its `defs` keys are deliberately bare for the same
// reason: two sources meaning different things by `Money` should collide
// visibly rather than coexist as two quietly different entries.
func shortName(name string) string {
	name = strings.TrimPrefix(name, ".")
	if i := strings.LastIndex(name, "."); i >= 0 {
		return name[i+1:]
	}

	return name
}

func join(scope, name string) string {
	if scope == "" {
		return name
	}

	return scope + "." + name
}
