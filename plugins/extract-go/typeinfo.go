package extractgo

import (
	"go/ast"
	"go/token"
	"sync"

	"github.com/shortlink-org/portolan/internal/goscan"
)

// typeInfo is the tree's declarations as goscan indexes them - struct fields,
// function results, what each local was assigned - with the way back from a
// parsed declaration to its entry. It is what lets a reader ask what type a
// receiver, a provider's result or a call's argument is, instead of guessing
// from a name. Still syntax: nothing here needs a Go toolchain.
type typeInfo struct {
	*goscan.Index
	functions map[*ast.FuncDecl]*goscan.Function
	files     map[*ast.File]*goscan.File
	// grpcRegistered is every type a Register<X>Server call hands over, by
	// type key; read once per tree.
	grpcRegistered map[string][]grpcRegistration
}

// The index of the last few trees read. One extraction reads one tree, and
// a replaced module brings a second; nothing needs to outlive that.
var typeInfoCache struct {
	sync.Mutex
	byTree map[*goscan.Tree]*typeInfo
}

// typesOf indexes a tree once. Nil for a package built without one, which is
// how the single-file tests parse: a reader then falls back to what the
// syntax alone says.
func typesOf(tree *goscan.Tree) *typeInfo {
	if tree == nil {
		return nil
	}
	typeInfoCache.Lock()
	defer typeInfoCache.Unlock()
	if info := typeInfoCache.byTree[tree]; info != nil {
		return info
	}
	if typeInfoCache.byTree == nil || len(typeInfoCache.byTree) >= 4 {
		typeInfoCache.byTree = map[*goscan.Tree]*typeInfo{}
	}
	info := &typeInfo{
		Index:     goscan.NewIndex(tree),
		functions: map[*ast.FuncDecl]*goscan.Function{},
		files:     map[*ast.File]*goscan.File{},
	}
	for _, fn := range info.Functions {
		info.functions[fn.Decl] = fn
	}
	for _, file := range tree.Files {
		info.files[file.Node] = file
	}
	info.KnownResults = interfaceResults(info.Index)
	info.grpcRegistered = info.readGRPCRegistrations()
	typeInfoCache.byTree[tree] = info

	return info
}

// interfaceResults is what each method of the tree's interfaces is declared
// to return, by "<interface key>.<Method>". A use case holds its repository
// as a port, and `uc.quotes.Get(ctx, id)` is a *quote.Quote because the port
// says so, whether or not an adapter in the tree implements it.
func interfaceResults(index *goscan.Index) map[string][]string {
	out := map[string][]string{}
	for _, file := range index.Files {
		for _, decl := range file.Node.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.TYPE {
				continue
			}
			for _, raw := range gen.Specs {
				spec := raw.(*ast.TypeSpec)
				iface, ok := spec.Type.(*ast.InterfaceType)
				if !ok || iface.Methods == nil {
					continue
				}
				for _, method := range iface.Methods.List {
					signature, ok := method.Type.(*ast.FuncType)
					if !ok || signature.Results == nil {
						continue
					}
					var results []string
					for _, field := range signature.Results.List {
						key := index.TypeKey(field.Type, file)
						for range max(1, len(field.Names)) {
							results = append(results, key)
						}
					}
					for _, name := range method.Names {
						out[file.Pkg+"."+spec.Name.Name+"."+name.Name] = results
					}
				}
			}
		}
	}

	return out
}

func (p *pkg) types() *typeInfo {
	if p == nil {
		return nil
	}

	return typesOf(p.index)
}

// function is the indexed entry of a declaration, or nil.
func (t *typeInfo) function(decl *ast.FuncDecl) *goscan.Function {
	if t == nil {
		return nil
	}

	return t.functions[decl]
}

// importPath is the import path of the package a parsed file belongs to.
func (t *typeInfo) importPath(file *ast.File) string {
	if t == nil {
		return ""
	}
	if found := t.files[file]; found != nil {
		return found.Pkg
	}

	return ""
}

// concrete is whether a type key names a non-interface type the tree
// declares: the only kind of answer that can rule a candidate out.
func (t *typeInfo) concrete(key string) bool {
	return t != nil && key != "" && t.Named[key] && t.Interfaces[key] == nil
}

// typeOf is the type key of an expression read inside fn: what TypeOf says,
// and `new(T)` - written there or assigned to a local - which it does not
// read.
func (t *typeInfo) typeOf(expr ast.Expr, fn *goscan.Function) string {
	if t == nil || fn == nil || expr == nil {
		return ""
	}
	expr = goscan.Unwrap(expr)
	if ident, ok := expr.(*ast.Ident); ok && fn.Types[ident.Name] == "" {
		if given, assigned := t.AssignedTo(fn, ident.Name); assigned && given.Index == 0 {
			if allocated, ok := newArgument(goscan.Unwrap(given.Expr)); ok {
				return t.TypeKey(allocated, fn.File)
			}
		}
	}
	if allocated, ok := newArgument(expr); ok {
		return t.TypeKey(allocated, fn.File)
	}

	return t.TypeOf(expr, fn)
}
