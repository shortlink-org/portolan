package main

// The closed sets an aggregate's fields take values from.
//
// Go has no enum. What it has is a convention, and the convention is what is
// read: a named type over a basic one - `type Reason string` - and a const
// block whose constants are of that type. The set is the constants, in the
// order they are written; a value's name is the constant's literal, because
// that is what a consumer sees on the wire, and the constant's own name only
// when the literal is not a string - an iota.
//
// Looked for in the aggregate's package, under vo/, and under event/: a
// reason is declared beside the event that carries it, and a status beside
// the root that holds it.

import (
	"go/ast"
	"go/token"
	"path"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func extractEnums(root, domainPath, aggID string, main *pkg, b *plugin.Builder) []catalog.Enum {
	var out []catalog.Enum

	out = append(out, enumsIn(main, aggID, "")...)

	for _, name := range subdirs(root, path.Join(domainPath, "vo")) {
		if name == "rules" {
			continue
		}
		p, err := parsePkg(root, path.Join(domainPath, "vo", name))
		if err != nil {
			continue
		}
		// Qualified the way a value object is, for the same reason: the
		// field that holds it says `password.Policy`, not `Policy`.
		out = append(out, enumsIn(p, aggID, p.name)...)
	}

	if p, err := parsePkg(root, path.Join(domainPath, "event")); err == nil {
		out = append(out, enumsIn(p, aggID, "")...)
	}

	_ = b

	return out
}

// enumDecl is a named basic type and the constants declared of it.
type enumDecl struct {
	name   string
	doc    string
	values []catalog.EnumValue
}

func enumsIn(p *pkg, aggID, qualifier string) []catalog.Enum {
	var out []catalog.Enum

	for _, decl := range p.enums() {
		label := decl.name
		if qualifier != "" {
			label = qualified(qualifier, decl.name)
		}

		out = append(out, catalog.Enum{
			ID:         blockID(aggID, slug(label)),
			Slug:       slug(label),
			Name:       label,
			Doc:        firstSentenceOrAll(decl.doc),
			Deprecated: deprecatedByDoc(decl.doc),
			Values:     decl.values,
		})
	}

	return out
}

// enums pairs every exported `type X <basic>` with the constants of type X,
// and keeps the pairs that have any. A type nothing is declared of is not a
// set; it is a name for a string.
func (p *pkg) enums() []enumDecl {
	var out []enumDecl
	byName := map[string]int{}

	for _, file := range p.files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.TYPE {
				continue
			}
			for _, spec := range gen.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok || !exported(typeSpec.Name.Name) || !isBasic(typeSpec.Type) {
					continue
				}
				comment := typeSpec.Doc
				if comment == nil && len(gen.Specs) == 1 {
					comment = gen.Doc
				}
				byName[typeSpec.Name.Name] = len(out)
				out = append(out, enumDecl{name: typeSpec.Name.Name, doc: comment.Text()})
			}
		}
	}

	for _, file := range p.files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			// Inside one block the type carries over: `A Status = iota` then
			// bare `B` and `C` are Status too. A new explicit type resets it.
			current := ""
			for _, spec := range gen.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				if value.Type != nil {
					current = ""
					if ident, ok := value.Type.(*ast.Ident); ok {
						current = ident.Name
					}
				} else if len(value.Values) > 0 {
					// An untyped constant: `X = "x"` belongs to no set.
					current = ""
				}
				at, known := byName[current]
				if !known {
					continue
				}
				doc := value.Doc.Text()
				if doc == "" && value.Comment != nil {
					doc = value.Comment.Text()
				}
				for i, name := range value.Names {
					if !exported(name.Name) {
						continue
					}
					literal := name.Name
					if i < len(value.Values) {
						if lit, ok := value.Values[i].(*ast.BasicLit); ok && lit.Kind == token.STRING {
							literal = strings.Trim(lit.Value, "`\"")
						}
					}
					out[at].values = append(out[at].values, catalog.EnumValue{
						Name:       literal,
						Doc:        firstSentenceOrAll(strings.TrimSpace(doc)),
						Deprecated: deprecatedByDoc(doc),
					})
				}
			}
		}
	}

	kept := out[:0]
	for _, decl := range out {
		if len(decl.values) > 0 {
			kept = append(kept, decl)
		}
	}

	return kept
}

// isBasic is `string`, `int`, `uint8` and the like - a named type over one of
// those is what a const block can be declared of.
func isBasic(expr ast.Expr) bool {
	ident, ok := expr.(*ast.Ident)
	if !ok {
		return false
	}
	switch ident.Name {
	case "string", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "byte", "rune":
		return true
	}

	return false
}

// deprecatedByDoc is the Go convention: a paragraph starting "Deprecated:".
func deprecatedByDoc(doc string) bool {
	for _, para := range strings.Split(doc, "\n\n") {
		if strings.HasPrefix(strings.TrimSpace(para), "Deprecated:") {
			return true
		}
	}

	return false
}
