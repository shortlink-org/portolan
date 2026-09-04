package main

import (
	"go/ast"
	"go/types"
	"strings"
)

// portBindings reads internal/di/provider for the one thing a use case cannot
// say about itself: which other use case fills a port it declares.
//
// A use case states its need as an interface of its own - login.Authenticator -
// precisely so that it does not import the package that satisfies it. The
// binding therefore exists nowhere in either of them; it exists in assembly,
// as a provider whose result is the port and whose parameter is the use case:
//
//	func ProvideAuthenticator(uc *authenticate.UseCase) login.Authenticator
//
// Result and parameter are both written in the signature, so for a port filled
// by one use case this reads the declaration and never the body.
//
// A port can also be filled by several use cases at once - one per method,
// with an adapter in between:
//
//	func ProvideLockout(check *check.UseCase, failed *record_failure.UseCase, ...) authenticate.Lockout {
//		return lockoutAdapter{check: check, failed: failed, ...}
//	}
//	func (l lockoutAdapter) Failed(ctx context.Context, id string) error {
//		return l.failed.Handle(ctx, ...)
//	}
//
// The signature alone cannot say which method reaches which use case, so
// these are read off the adapter: the struct the provider returns, and which
// field's Handle each of its methods calls. Such a binding is keyed by port
// and method, "user/authenticate.Lockout.Failed", beside the port-level key
// the single-use-case case produces. An adapter this cannot read falls back to
// the first use case in the signature, which is the reading it always had.
//
// A provider that builds its port out of something else is not a binding
// between use cases and does not appear here.
func portBindings(root string) map[string]string {
	out := map[string]string{}

	pkg, err := parsePkg(root, "internal/di/provider")
	if err != nil {
		return out
	}

	for _, file := range pkg.files {
		useCases := useCaseImports(file)
		if len(useCases) == 0 {
			continue
		}

		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || fn.Type.Results == nil {
				continue
			}
			if len(fn.Type.Results.List) != 1 {
				// A provider that returns a port and an error is still a
				// provider, but two results here means the port is not the
				// whole answer and reading it as one would be a guess.
				continue
			}

			port, ok := portName(fn.Type.Results.List[0].Type, useCases)
			if !ok {
				continue
			}

			var bound []string
			for _, param := range params(fn) {
				if useCase, ok := useCaseParam(param, useCases); ok {
					bound = append(bound, useCase)
				}
			}
			if len(bound) == 0 {
				continue
			}

			if len(bound) > 1 {
				perMethod := methodBindings(file, fn, useCases)
				for method, useCase := range perMethod {
					out[port+"."+method] = useCase
				}
				if len(perMethod) > 0 {
					continue
				}
			}

			out[port] = bound[0]
		}
	}

	return out
}

// methodBindings reads which use case each method of a provider's adapter
// reaches: the struct the provider returns, its fields' types, and the field
// whose Handle each method calls. Empty when any of those cannot be read.
func methodBindings(file *ast.File, provider *ast.FuncDecl, useCases map[string]string) map[string]string {
	adapter := returnedType(provider)
	if adapter == "" {
		return nil
	}

	fields := adapterFields(file, adapter)
	out := map[string]string{}

	for method, field := range handleCalls(file, adapter) {
		if useCase, ok := useCaseParam(fields[field], useCases); ok {
			out[method] = useCase
		}
	}

	return out
}

// returnedType names the struct a provider returns as a composite literal,
// `return lockoutAdapter{...}` or `return &lockoutAdapter{...}`. Anything else
// - a call, a variable - is not read.
func returnedType(fn *ast.FuncDecl) string {
	if fn.Body == nil {
		return ""
	}

	name := ""
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		ret, ok := n.(*ast.ReturnStmt)
		if !ok || len(ret.Results) != 1 || name != "" {
			return true
		}

		expr := ret.Results[0]
		if unary, ok := expr.(*ast.UnaryExpr); ok {
			expr = unary.X
		}
		if lit, ok := expr.(*ast.CompositeLit); ok {
			if ident, ok := lit.Type.(*ast.Ident); ok {
				name = ident.Name
			}
		}

		return true
	})

	return name
}

// adapterFields reads the field types of a struct declared in the file.
func adapterFields(file *ast.File, typeName string) map[string]ast.Expr {
	out := map[string]ast.Expr{}

	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gen.Specs {
			ts, ok := spec.(*ast.TypeSpec)
			if !ok || ts.Name.Name != typeName {
				continue
			}
			st, ok := ts.Type.(*ast.StructType)
			if !ok {
				continue
			}
			for _, field := range st.Fields.List {
				for _, name := range field.Names {
					out[name.Name] = field.Type
				}
			}
		}
	}

	return out
}

// handleCalls reads, for every method on typeName in the file, the field whose
// Handle it calls: `l.failed.Handle(ctx, ...)` gives Failed -> "failed". A
// method that calls Handle on two fields is read as the first; none here does.
func handleCalls(file *ast.File, typeName string) map[string]string {
	out := map[string]string{}

	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv == nil || fn.Body == nil || receiverTypeName(fn) != typeName {
			continue
		}
		recv := receiverIdent(fn)
		if recv == "" {
			continue
		}

		ast.Inspect(fn.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "Handle" {
				return true
			}
			field, ok := sel.X.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			base, ok := field.X.(*ast.Ident)
			if !ok || base.Name != recv {
				return true
			}
			if _, seen := out[fn.Name.Name]; !seen {
				out[fn.Name.Name] = field.Sel.Name
			}

			return true
		})
	}

	return out
}

// receiverTypeName reads `lockoutAdapter` off `(l lockoutAdapter)` and
// `(l *lockoutAdapter)` alike.
func receiverTypeName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return ""
	}

	expr := fn.Recv.List[0].Type
	if star, ok := expr.(*ast.StarExpr); ok {
		expr = star.X
	}
	if ident, ok := expr.(*ast.Ident); ok {
		return ident.Name
	}

	return ""
}

// portName turns the result type `login.Authenticator` into the key the use
// case's own field carries: "session/login.Authenticator". The field is written
// unqualified there - it is declared in that package - so the use case has to
// be part of the key or two ports of the same name would collide.
func portName(expr ast.Expr, useCases map[string]string) (string, bool) {
	selector, name, found := strings.Cut(types.ExprString(expr), ".")
	if !found {
		return "", false
	}

	useCase, known := useCases[selector]
	if !known {
		return "", false
	}

	return useCase + "." + name, true
}

// useCaseParam reads `*authenticate.UseCase` back to "user/authenticate".
func useCaseParam(expr ast.Expr, useCases map[string]string) (string, bool) {
	selector, name, found := strings.Cut(strings.TrimPrefix(types.ExprString(expr), "*"), ".")
	if !found || name != "UseCase" {
		return "", false
	}

	useCase, known := useCases[selector]

	return useCase, known
}

// adapterDecl is a provider whose result is a port of a use case and whose
// parameters are not another use case: whatever it builds the port out of,
// the flow reader will have to follow.
type adapterDecl struct {
	pkg     *pkg
	fn      *ast.FuncDecl
	imports map[string]string
}

// adapterBindings reads the same directory for the other kind of binding: a
// port filled by an adapter over something that is not a use case - a
// generated client, say. What that something is, and what the adapter does
// with it, is left to the reader that follows it; here the declaration is
// enough to know which provider to follow.
func adapterBindings(root string) map[string]adapterDecl {
	out := map[string]adapterDecl{}
	pkg, err := parsePkg(root, "internal/di/provider")
	if err != nil {
		return out
	}

	for _, file := range pkg.files {
		useCases := useCaseImports(file)
		if len(useCases) == 0 {
			continue
		}
		imports := map[string]string{}
		for _, spec := range file.Imports {
			importPath := strings.Trim(spec.Path.Value, `"`)
			name := importPath[strings.LastIndex(importPath, "/")+1:]
			if spec.Name != nil {
				name = spec.Name.Name
			}
			imports[name] = importPath
		}

		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || fn.Type.Results == nil || len(fn.Type.Results.List) != 1 {
				continue
			}
			port, ok := portName(fn.Type.Results.List[0].Type, useCases)
			if !ok {
				continue
			}
			bound := false
			for _, param := range params(fn) {
				if _, ok := useCaseParam(param, useCases); ok {
					bound = true
				}
			}
			if bound {
				continue
			}
			out[port] = adapterDecl{pkg: pkg, fn: fn, imports: imports}
		}
	}

	return out
}

func params(fn *ast.FuncDecl) []ast.Expr {
	if fn.Type.Params == nil {
		return nil
	}

	var out []ast.Expr
	for _, param := range fn.Type.Params.List {
		out = append(out, param.Type)
	}

	return out
}
