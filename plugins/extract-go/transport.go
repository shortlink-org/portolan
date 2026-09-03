package main

import (
	"go/ast"
	"go/types"
	"path"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/plugin"
)

// extractTransport reads the http layer and answers with which endpoints run
// which use case, keyed by "<aggregate>/<use case>".
//
// Three things in a handler say it, and they agree:
//
//	// RegisterUser implements POST /v1/users.
//	func (h *Users) RegisterUser(ctx context.Context, request gen.RegisterUserRequestObject) ... {
//		out, err := h.register.Handle(ctx, dto.Input{...})
//
// The method name is the generated server's, which is the document's
// operationId with a capital letter; `register` is a field of the handler
// struct, declared as *register.UseCase; and the import that names it says
// which aggregate's use case that is. None of it needs a type checker, and
// none of it needs the OpenAPI document - which is the point, because the
// document is read by a different extractor that knows nothing about Go.
func extractTransport(root string, b *plugin.Builder) (map[string][]string, []endpointDecl) {
	out := map[string][]string{}
	var endpoints []endpointDecl

	base := "internal/infrastructure/transport/http"
	for _, dir := range subdirs(root, base) {
		// The generated server is not a handler package: it declares the
		// interface these implement, and reading it would pair every operation
		// with itself.
		if dir == "gen" {
			continue
		}

		pkg, err := parsePkg(root, path.Join(base, dir))
		if err != nil {
			continue
		}

		for name, useCase := range handlerFields(pkg) {
			for _, endpoint := range operationsRunning(pkg, name, useCase, b) {
				endpoints = append(endpoints, endpoint)
				for _, useCase := range endpoint.useCases {
					out[useCase] = appendOnce(out[useCase], endpoint.id)
				}
			}
		}
	}

	// Both the struct set and the method set are walked as maps, so the order
	// operations arrive in is not the order they were written in. Sorting here
	// is what keeps the fragment byte-identical between runs.
	for useCase := range out {
		sort.Strings(out[useCase])
	}
	sort.Slice(endpoints, func(i, j int) bool { return endpoints[i].id < endpoints[j].id })

	return out, endpoints
}

// handlerFields maps each handler struct to the use case behind each of its
// fields: Users{register: *register.UseCase} gives {"Users": {"register":
// "user/register"}}.
func handlerFields(pkg *pkg) map[string]map[string]string {
	out := map[string]map[string]string{}

	for _, file := range pkg.files {
		useCases := useCaseImports(file)
		if len(useCases) == 0 {
			continue
		}

		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}

			for _, spec := range gen.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				structType, ok := typeSpec.Type.(*ast.StructType)
				if !ok || structType.Fields == nil {
					continue
				}

				fields := map[string]string{}
				for _, field := range structType.Fields.List {
					// The field is what a use case is held in, and its type is
					// what says which one: *register.UseCase.
					selector, _, found := strings.Cut(strings.TrimPrefix(types.ExprString(field.Type), "*"), ".")
					if !found {
						continue
					}

					useCase, known := useCases[selector]
					if !known {
						continue
					}
					for _, name := range field.Names {
						fields[name.Name] = useCase
					}
				}

				if len(fields) > 0 {
					out[typeSpec.Name.Name] = fields
				}
			}
		}
	}

	return out
}

// useCaseImports maps the name a file refers to a use case package by - its
// alias, or the last segment of its path - to "<aggregate>/<use case>".
//
// The aggregate is carried because a use case directory name is only unique
// within one: two aggregates may each have a `get`, and pairing an endpoint
// with the wrong one would be worse than pairing it with nothing.
func useCaseImports(file *ast.File) map[string]string {
	out := map[string]string{}

	for _, spec := range file.Imports {
		importPath := strings.Trim(spec.Path.Value, `"`)

		before, after, found := strings.Cut(importPath, "/internal/application/")
		if !found || before == "" {
			continue
		}

		aggregate, rest, found := strings.Cut(after, "/usecases/")
		// Anything deeper - a use case's dto package, say - is not the use case.
		if !found || strings.Contains(rest, "/") {
			continue
		}

		name := rest
		if spec.Name != nil {
			name = spec.Name.Name
		}
		out[name] = aggregate + "/" + rest
	}

	return out
}

// endpointDecl is one operation of the generated server: what it is called in
// the document, the use cases it runs in the order it runs them, and where the
// method that does it can be read.
//
// The order matters twice over. It is what pairs an operation with the use
// cases the catalog says it exposes, and it is the opening of a flow: an
// endpoint that validates a token and then changes a password does those two
// things in that order, and a picture that swapped them would be wrong.
type endpointDecl struct {
	id       string
	useCases []string
	source   string
	line     int
}

// operationsRunning finds the handler methods on a struct and the use cases
// each one reaches.
func operationsRunning(pkg *pkg, structName string, fields map[string]string, b *plugin.Builder) []endpointDecl {
	var out []endpointDecl

	for name, fn := range pkg.methods(structName) {
		if !isHandler(fn) {
			continue
		}

		operation := lowerFirst(name)
		used := useCasesTouched(fn, fields)

		if len(used) == 0 {
			// An endpoint that reaches no use case is doing the work itself, or
			// doing nothing. Either is worth saying out loud.
			b.Warn(operation, pkg.dir+": "+name+" runs no use case; the operation is not paired with anything")

			continue
		}

		source, line := pkg.position(fn.Pos())
		out = append(out, endpointDecl{id: operation, useCases: used, source: source, line: line})
	}

	return out
}

// isHandler tells a generated-server method from a helper beside it. The
// generated interface takes a `gen.XxxRequestObject`, and nothing else in these
// packages does.
func isHandler(fn *ast.FuncDecl) bool {
	if fn.Type.Params == nil {
		return false
	}

	for _, param := range fn.Type.Params.List {
		if strings.HasSuffix(types.ExprString(param.Type), "RequestObject") {
			return true
		}
	}

	return false
}

// useCasesTouched collects the receiver's use case fields a body reaches, in a
// stable order.
//
// Any mention counts, not only a call: a handler that resolves a bearer token
// through one use case before running another has been served by both, and
// which of them it happens to call through a helper is not a fact about the
// endpoint.
func useCasesTouched(fn *ast.FuncDecl, fields map[string]string) []string {
	receiver := receiverIdent(fn)
	if receiver == "" || fn.Body == nil {
		return nil
	}

	var out []string
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		selector, ok := node.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		ident, ok := selector.X.(*ast.Ident)
		if !ok || ident.Name != receiver {
			return true
		}

		if useCase, known := fields[selector.Sel.Name]; known {
			out = appendOnce(out, useCase)
		}

		return true
	})

	return out
}

func receiverIdent(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 || len(fn.Recv.List[0].Names) == 0 {
		return ""
	}

	return fn.Recv.List[0].Names[0].Name
}

func appendOnce(list []string, value string) []string {
	for _, existing := range list {
		if existing == value {
			return list
		}
	}

	return append(list, value)
}

// lowerFirst turns a generated method name back into the operationId it was
// built from: RegisterUser was registerUser in the document.
func lowerFirst(name string) string {
	if name == "" {
		return name
	}

	runes := []rune(name)
	if runes[0] >= 'A' && runes[0] <= 'Z' {
		runes[0] = runes[0] - 'A' + 'a'
	}

	return string(runes)
}
