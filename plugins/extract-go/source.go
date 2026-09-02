package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// A parsed package: the files that make it up, and where they came from.
//
// Tests are left out. A _test.go file is about how the code is exercised, and
// a helper struct in one is not part of the domain however much it looks like
// it.
type pkg struct {
	dir   string // as a reader would open it, relative to the repository
	name  string
	files []*ast.File
	fset  *token.FileSet
	paths map[*ast.File]string
}

func parsePkg(root, rel string) (*pkg, error) {
	dir := filepath.Join(root, rel)

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	p := &pkg{
		dir:   path.Join(filepath.ToSlash(root), rel),
		fset:  token.NewFileSet(),
		paths: map[*ast.File]string{},
	}

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}

		file, err := parser.ParseFile(p.fset, filepath.Join(dir, name), nil, parser.ParseComments)
		if err != nil {
			return nil, err
		}

		p.name = file.Name.Name
		p.files = append(p.files, file)
		p.paths[file] = path.Join(p.dir, name)
	}

	if len(p.files) == 0 {
		return nil, os.ErrNotExist
	}

	return p, nil
}

// doc is the package comment: the block immediately above `package x`, in
// whichever file carries it.
//
// It is the aggregate's readme, and it is worth saying why that is not a
// fallback. A package comment is where a Go author already writes down what the
// package is for and what it refuses to do; asking them to write it a second
// time somewhere a generator can find it is how documentation goes stale.
func (p *pkg) doc() string {
	for _, file := range p.files {
		if file.Doc == nil {
			continue
		}
		if text := strings.TrimSpace(file.Doc.Text()); text != "" {
			return text
		}
	}

	return ""
}

// position is where a node sits, as a reader would write it down: the file
// path relative to the repository, and the line. It is what a flow step points
// at, and it is read from the file set rather than remembered per declaration.
func (p *pkg) position(pos token.Pos) (string, int) {
	at := p.fset.Position(pos)

	return filepath.ToSlash(at.Filename), at.Line
}

// structDecl is a named struct type with the comment above it.
type structDecl struct {
	name   string
	doc    string
	fields *ast.StructType
	source string
}

func (p *pkg) structs() []structDecl {
	var out []structDecl

	for _, file := range p.files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.TYPE {
				continue
			}

			for _, spec := range gen.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				structType, ok := typeSpec.Type.(*ast.StructType)
				if !ok {
					continue
				}

				// A single-spec declaration carries its comment on the
				// GenDecl; one inside a `type (...)` block carries its own.
				comment := typeSpec.Doc
				if comment == nil && len(gen.Specs) == 1 {
					comment = gen.Doc
				}

				out = append(out, structDecl{
					name:   typeSpec.Name.Name,
					doc:    firstSentenceOrAll(comment.Text()),
					fields: structType,
					source: p.paths[file],
				})
			}
		}
	}

	return out
}

// methods returns the methods declared on a receiver type, by name.
func (p *pkg) methods(recv string) map[string]*ast.FuncDecl {
	out := map[string]*ast.FuncDecl{}

	for _, file := range p.files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv == nil || len(fn.Recv.List) == 0 {
				continue
			}
			if receiverName(fn.Recv.List[0].Type) == recv {
				out[fn.Name.Name] = fn
			}
		}
	}

	return out
}

func receiverName(expr ast.Expr) string {
	if star, ok := expr.(*ast.StarExpr); ok {
		expr = star.X
	}
	if ident, ok := expr.(*ast.Ident); ok {
		return ident.Name
	}

	return ""
}

// fields turns a struct's members into catalog fields.
//
// The type is rendered from the syntax rather than resolved: `email.Address`
// is written down as `email.Address`, which is what a reader of the catalog
// wants to see and what the shape of the schema asks for. Resolving it would
// need the whole module built, and would answer a question nobody asked.
func fields(st *ast.StructType) []catalog.Field {
	if st == nil || st.Fields == nil {
		return nil
	}

	var out []catalog.Field
	for _, field := range st.Fields.List {
		typeName := types.ExprString(field.Type)

		doc := strings.TrimSpace(field.Doc.Text())
		if doc == "" {
			doc = strings.TrimSpace(field.Comment.Text())
		}
		doc = firstSentenceOrAll(doc)

		if len(field.Names) == 0 {
			// An embedded field: named by its type.
			out = append(out, catalog.Field{Name: typeName, Type: typeName, Doc: doc})

			continue
		}

		for _, name := range field.Names {
			out = append(out, catalog.Field{Name: name.Name, Type: typeName, Doc: doc})
		}
	}

	return out
}

// returnedString is the string literal a one-line method returns, which is how
// an event's name on the bus is read out of `func (E) Name() string`.
func returnedString(fn *ast.FuncDecl) (string, bool) {
	if fn == nil || fn.Body == nil {
		return "", false
	}

	for _, stmt := range fn.Body.List {
		ret, ok := stmt.(*ast.ReturnStmt)
		if !ok || len(ret.Results) != 1 {
			continue
		}
		lit, ok := ret.Results[0].(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			continue
		}
		value, err := strconv.Unquote(lit.Value)
		if err != nil {
			continue
		}

		return value, true
	}

	return "", false
}

// calls reports whether a function's body calls a method with one of these
// names on anything at all.
func calls(fn *ast.FuncDecl, names ...string) bool {
	if fn == nil || fn.Body == nil {
		return false
	}

	wanted := map[string]bool{}
	for _, name := range names {
		wanted[name] = true
	}

	found := false
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		if selector, ok := call.Fun.(*ast.SelectorExpr); ok && wanted[selector.Sel.Name] {
			found = true

			return false
		}

		return true
	})

	return found
}

// subdirs lists the immediate subdirectories of a path, sorted by os.ReadDir,
// which reads them in filename order - so the fragment comes out the same way
// every time.
func subdirs(root, rel string) []string {
	entries, err := os.ReadDir(filepath.Join(root, rel))
	if err != nil {
		return nil
	}

	var out []string
	for _, entry := range entries {
		if entry.IsDir() {
			out = append(out, entry.Name())
		}
	}

	return out
}

// firstSentenceOrAll trims a doc comment down to something that fits in a
// table cell, and leaves it alone when it is already short.
//
// Go doc comments open with a sentence naming the thing, then explain. The
// first sentence is the label; the rest belongs on the page, not in a column.
func firstSentenceOrAll(doc string) string {
	doc = strings.TrimSpace(doc)
	if doc == "" {
		return ""
	}

	// Everything up to the first blank line is the opening paragraph.
	if i := strings.Index(doc, "\n\n"); i >= 0 {
		doc = doc[:i]
	}

	return strings.Join(strings.Fields(doc), " ")
}

// parseSource builds a package out of one file of source. It exists for tests:
// every other caller has a directory.
func parseSource(name, src string) (*pkg, error) {
	fset := token.NewFileSet()

	file, err := parser.ParseFile(fset, name, src, parser.ParseComments)
	if err != nil {
		return nil, err
	}

	return &pkg{
		dir:   ".",
		name:  file.Name.Name,
		files: []*ast.File{file},
		fset:  fset,
		paths: map[*ast.File]string{file: name},
	}, nil
}
