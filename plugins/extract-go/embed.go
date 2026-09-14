package extractgo

import (
	"go/ast"
	"go/types"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
)

// Embedding is composition, and a reader of the catalog should see what it
// composes: an event that embeds ddd.Base carries an aggregate id and a
// moment, and a table that says `ddd.Base` instead says nothing about either.
//
// The embedded type is found where the go command would find it - this
// package, another package of the module, or a module a go.mod `replace`
// points at a directory. The module cache is outside the workspace a plugin
// reads (portolan.0006), so a type from there stays the row the source
// spells: its name and its type, not a guess at its fields.

// typeDecl is a named type and the package and file that declare it, so
// what its body names is read with that file's imports.
type typeDecl struct {
	pkg  *pkg
	file *ast.File
	spec *ast.TypeSpec
}

// typeNamed is a type this package declares, by name.
func (p *pkg) typeNamed(name string) (typeDecl, bool) {
	for _, file := range p.files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range gen.Specs {
				if typeSpec, ok := spec.(*ast.TypeSpec); ok && typeSpec.Name.Name == name {
					return typeDecl{pkg: p, file: file, spec: typeSpec}, true
				}
			}
		}
	}

	return typeDecl{}, false
}

// resolveType is the declaration a type expression written in file names:
// `Base`, `*ddd.Base`, `ddd.Root[ID]`. An alias over another named type is
// followed to that type. A defined type - `type Base ddd.Base` - is followed
// too when fields are wanted, since it has the fields of the type underneath;
// not for methods, since it has none of that type's methods.
func (p *pkg) resolveType(file *ast.File, expr ast.Expr, forMethods bool) (typeDecl, bool) {
	for hops := 0; hops < 8; hops++ {
		decl, ok := p.resolveName(file, expr)
		if !ok {
			return typeDecl{}, false
		}
		if forMethods && !decl.spec.Assign.IsValid() {
			return decl, true
		}
		switch decl.spec.Type.(type) {
		case *ast.Ident, *ast.SelectorExpr, *ast.StarExpr, *ast.IndexExpr, *ast.IndexListExpr:
			p, file, expr = decl.pkg, decl.file, decl.spec.Type
		default:
			return decl, true
		}
	}

	return typeDecl{}, false
}

func (p *pkg) resolveName(file *ast.File, expr ast.Expr) (typeDecl, bool) {
	for {
		switch value := expr.(type) {
		case *ast.StarExpr:
			expr = value.X
		case *ast.ParenExpr:
			expr = value.X
		case *ast.IndexExpr:
			expr = value.X
		case *ast.IndexListExpr:
			expr = value.X
		case *ast.Ident:
			return p.typeNamed(value.Name)
		case *ast.SelectorExpr:
			alias, ok := value.X.(*ast.Ident)
			if !ok {
				return typeDecl{}, false
			}
			imported := p.importedPkg(file, alias.Name)
			if imported == nil {
				return typeDecl{}, false
			}
			return imported.typeNamed(value.Sel.Name)
		default:
			return typeDecl{}, false
		}
	}
}

// importedPkg is the package a file refers to by a name: the alias it gave
// the import, or the name the package declares, which need not be the last
// segment of its path.
func (p *pkg) importedPkg(file *ast.File, name string) *pkg {
	if p.index == nil {
		return nil
	}
	if importPath := goscan.ImportsOf(file)[name]; importPath != "" {
		if found := p.pkgAt(importPath); found != nil && (found.name == name || aliased(file, importPath, name)) {
			return found
		}
	}
	for _, spec := range file.Imports {
		if spec.Name != nil {
			continue
		}
		if found := p.pkgAt(strings.Trim(spec.Path.Value, `"`)); found != nil && found.name == name {
			return found
		}
	}

	return nil
}

func aliased(file *ast.File, importPath, name string) bool {
	for _, spec := range file.Imports {
		if spec.Name != nil && spec.Name.Name == name && strings.Trim(spec.Path.Value, `"`) == importPath {
			return true
		}
	}

	return false
}

func (p *pkg) pkgAt(importPath string) *pkg {
	tree, dir, ok := p.index.Locate(importPath)
	if !ok {
		return nil
	}
	found, err := parsePkg(tree.Root, dir, tree)
	if err != nil {
		return nil
	}

	return found
}

// fieldsOf is a struct's fields as the catalog lists them, an embedded
// struct's fields standing where the embedded field is written.
func (p *pkg) fieldsOf(decl structDecl) []catalog.Field {
	return selectable(p.structFields(decl.file, decl.fields, 0, map[*ast.TypeSpec]bool{}))
}

type depthField struct {
	catalog.Field
	depth int
}

func (p *pkg) structFields(file *ast.File, st *ast.StructType, depth int, visiting map[*ast.TypeSpec]bool) []depthField {
	var out []depthField
	for _, field := range fields(st) {
		out = append(out, depthField{Field: field.Field, depth: depth})
		if field.embedded == nil {
			continue
		}
		decl, ok := p.resolveType(file, field.embedded, false)
		if !ok || visiting[decl.spec] {
			continue
		}
		body, isStruct := decl.spec.Type.(*ast.StructType)
		if !isStruct {
			continue
		}
		visiting[decl.spec] = true
		out = append(out[:len(out)-1], decl.pkg.structFields(decl.file, body, depth+1, visiting)...)
		delete(visiting, decl.spec)
	}

	return out
}

// selectable keeps the fields a selector can reach, in declaration order: a
// shallower field hides a deeper one of the same name, and two at the same
// depth hide each other - the language's rule, so the table lists what
// `e.name` means.
func selectable(all []depthField) []catalog.Field {
	shallowest := map[string]int{}
	count := map[string]int{}
	for _, field := range all {
		if depth, seen := shallowest[field.Name]; !seen || field.depth < depth {
			shallowest[field.Name] = field.depth
			count[field.Name] = 0
		}
		if field.depth == shallowest[field.Name] {
			count[field.Name]++
		}
	}

	var out []catalog.Field
	for _, field := range all {
		if field.depth == shallowest[field.Name] && count[field.Name] == 1 {
			out = append(out, field.Field)
		}
	}

	return out
}

// method is the method a value of the named type answers to, and the package
// that declares it: its own, or one an embedded struct promotes, by the same
// depth rule as a field. Nil when there is none, when two embedded types at
// one depth both have it, or when it comes from an embedded interface and
// so has no body to read.
func (p *pkg) method(typeName, name string) (*pkg, *ast.FuncDecl) {
	if fn := p.methods(typeName)[name]; fn != nil {
		return p, fn
	}

	decl, ok := p.typeNamed(typeName)
	if !ok {
		return nil, nil
	}
	current := []typeDecl{decl}
	seen := map[*ast.TypeSpec]bool{decl.spec: true}
	for len(current) > 0 {
		var next []typeDecl
		var owner *pkg
		var found *ast.FuncDecl
		hits := 0
		for _, holder := range current {
			body, ok := holder.spec.Type.(*ast.StructType)
			if !ok {
				continue
			}
			for _, field := range fields(body) {
				if field.embedded == nil {
					continue
				}
				embedded, ok := holder.pkg.resolveType(holder.file, field.embedded, true)
				if !ok || seen[embedded.spec] {
					continue
				}
				seen[embedded.spec] = true
				if fn := embedded.pkg.methods(embedded.spec.Name.Name)[name]; fn != nil {
					owner, found, hits = embedded.pkg, fn, hits+1
					continue
				}
				if _, asks := interfaceMethod(embedded, name); asks != nil {
					hits++
					continue
				}
				next = append(next, embedded)
			}
		}
		if hits > 0 {
			if hits > 1 {
				return nil, nil
			}
			return owner, found
		}
		current = next
	}

	return nil, nil
}

// interfaceMethod is the signature an interface gives a method, and the
// package that writes it: its own method, or one an embedded interface
// asks for. Nil when the interface does not ask for it.
func interfaceMethod(decl typeDecl, name string) (*pkg, *ast.FuncType) {
	return interfaceMethodIn(decl, name, map[*ast.TypeSpec]bool{})
}

func interfaceMethodIn(decl typeDecl, name string, visiting map[*ast.TypeSpec]bool) (*pkg, *ast.FuncType) {
	iface, ok := decl.spec.Type.(*ast.InterfaceType)
	if !ok || iface.Methods == nil || visiting[decl.spec] {
		return nil, nil
	}
	visiting[decl.spec] = true
	defer delete(visiting, decl.spec)

	for _, method := range iface.Methods.List {
		if fn, ok := method.Type.(*ast.FuncType); ok {
			for _, ident := range method.Names {
				if ident.Name == name {
					return decl.pkg, fn
				}
			}
		}
	}
	for _, method := range iface.Methods.List {
		if len(method.Names) != 0 {
			continue
		}
		embedded, ok := decl.pkg.resolveType(decl.file, method.Type, true)
		if !ok {
			continue
		}
		if owner, fn := interfaceMethodIn(embedded, name, visiting); fn != nil {
			return owner, fn
		}
	}

	return nil, nil
}

// structField is one field as written, with the type expression of an
// embedded one kept so it can be followed.
type structField struct {
	catalog.Field
	embedded ast.Expr
}

// fields turns a struct's members into catalog fields, as written.
//
// The type is rendered from the syntax rather than resolved: `email.Address`
// is written down as `email.Address`, which is what a reader of the catalog
// wants to see and what the shape of the schema asks for. An embedded field
// is named the way the language names it - `Base` for `*ddd.Base` - and kept
// for fieldsOf to unpack.
func fields(st *ast.StructType) []structField {
	if st == nil || st.Fields == nil {
		return nil
	}

	var out []structField
	for _, field := range st.Fields.List {
		typeName := types.ExprString(field.Type)

		doc := strings.TrimSpace(field.Doc.Text())
		if doc == "" {
			doc = strings.TrimSpace(field.Comment.Text())
		}
		doc = firstSentenceOrAll(doc)

		if len(field.Names) == 0 {
			out = append(out, structField{Field: catalog.Field{Name: goscan.EmbeddedName(field.Type), Type: typeName, Doc: doc}, embedded: field.Type})

			continue
		}

		for _, name := range field.Names {
			out = append(out, structField{Field: catalog.Field{Name: name.Name, Type: typeName, Doc: doc}})
		}
	}

	return out
}
