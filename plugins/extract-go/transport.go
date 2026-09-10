package extractgo

import (
	"go/ast"
	"go/types"
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
func extractTransport(root string, layout sourceLayout, b *plugin.Builder) (map[string][]string, []endpointDecl) {
	out := map[string][]string{}
	var endpoints []endpointDecl

	for _, dir := range layout.http {
		for _, endpoint := range readTransportPackage(root, dir, layout, isHandler, lowerFirst, nil, b) {
			endpoints = append(endpoints, endpoint)
			for _, useCase := range endpoint.useCases {
				out[useCase] = appendOnce(out[useCase], endpoint.id)
			}
		}
	}

	// A gRPC handler is read the same way, and differs in two things: what
	// marks a method as one of the contract's, and what the endpoint is called.
	// An rpc is named the same on both sides - GetQuote is GetQuote - so the
	// method name is the id, and it is the id extract-proto puts in `provides`.
	for _, dir := range layout.grpc {
		for _, endpoint := range readTransportPackage(root, dir, layout, isRpcHandler, sameName, grpcMethodRef, b) {
			endpoints = append(endpoints, endpoint)
			for _, useCase := range endpoint.useCases {
				out[useCase] = appendOnce(out[useCase], endpoint.id)
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

// readTransportPackage reads one discovered handler package: a struct per
// server, and the methods of it that answer something.
func readTransportPackage(root, dir string, layout sourceLayout, handler func(*ast.FuncDecl) bool, id func(string) string, ref func(string, *pkg, string, string) string, b *plugin.Builder) []endpointDecl {
	var endpoints []endpointDecl

	pkg, err := parsePkg(root, dir, layout.index)
	if err != nil {
		return endpoints
	}

	for name, useCase := range handlerFields(pkg, layout) {
		found := operationsRunning(pkg, name, useCase, handler, id, b)
		if ref != nil {
			for i := range found {
				found[i].ref = ref(root, pkg, name, found[i].id)
			}
		}
		endpoints = append(endpoints, found...)
	}

	return endpoints
}

// handlerFields maps each handler struct to the use case behind each of its
// fields: Users{register: *register.UseCase} gives {"Users": {"register":
// "user/register"}}.
func handlerFields(pkg *pkg, layouts ...sourceLayout) map[string]map[string]string {
	out := map[string]map[string]string{}

	for _, file := range pkg.files {
		useCases := useCaseImports(file, layouts...)
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
func useCaseImports(file *ast.File, layouts ...sourceLayout) map[string]string {
	out := map[string]string{}

	for _, spec := range file.Imports {
		importPath := strings.Trim(spec.Path.Value, `"`)

		aggregate, useCaseName, found := useCaseImport(importPath)
		if !found {
			continue
		}
		key := aggregate + "/" + useCaseName
		if len(layouts) > 0 {
			if _, discovered := layouts[0].useCases[key]; !discovered {
				continue
			}
		}

		name := useCaseName
		if spec.Name != nil {
			name = spec.Name.Name
		}
		out[name] = key
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
	ref      string
	useCases []string
	source   string
	line     int
}

// grpcMethodRef resolves the generated server embedded by a handler back to
// the protocol identifier carried by protoc-gen-go-grpc. The handler method
// gives us only ArchivePriceList; the generated constant gives us the stable
// shop.v1.PriceLists/ArchivePriceList that joins the flow to its contract.
func grpcMethodRef(root string, handlerPkg *pkg, structName, method string) string {
	var generatedPkg *pkg
	serviceName := ""

	for _, declared := range handlerPkg.structs() {
		if declared.name != structName || declared.fields == nil || declared.fields.Fields == nil {
			continue
		}
		for _, field := range declared.fields.Fields.List {
			if len(field.Names) != 0 {
				continue
			}

			typeName := strings.TrimPrefix(types.ExprString(field.Type), "*")
			selector, embedded, qualified := strings.Cut(typeName, ".")
			if !qualified {
				embedded = selector
				generatedPkg = handlerPkg
			} else {
				importPath := importsOf(handlerPkg)[selector]
				module := modulePath(root)
				rel, local := strings.CutPrefix(importPath, module+"/")
				if importPath == "" || module == "" || !local {
					continue
				}
				parsed, err := parsePkg(root, rel, handlerPkg.index)
				if err != nil {
					continue
				}
				generatedPkg = parsed
			}

			name, ok := strings.CutPrefix(embedded, "Unimplemented")
			if !ok {
				continue
			}
			name, ok = strings.CutSuffix(name, "Server")
			if !ok || name == "" {
				continue
			}
			serviceName = name
			break
		}
	}

	if generatedPkg == nil || serviceName == "" {
		return ""
	}
	clients, _ := readClients(generatedPkg)
	return clients[serviceName+"Client"].methods[method]
}

// operationsRunning finds the handler methods on a struct and the use cases
// each one reaches.
func operationsRunning(pkg *pkg, structName string, fields map[string]string, handler func(*ast.FuncDecl) bool, id func(string) string, b *plugin.Builder) []endpointDecl {
	var out []endpointDecl

	for name, fn := range pkg.methods(structName) {
		if !handler(fn) {
			continue
		}

		operation := id(name)
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

// isRpcHandler tells a generated-server method from a helper beside it. A
// protoc-gen-go-grpc server takes a context and a pointer to the request
// message and answers with a pointer and an error, and the generated
// Unimplemented embed is what says the struct is one of those servers at all.
func isRpcHandler(fn *ast.FuncDecl) bool {
	if fn.Type.Params == nil || fn.Type.Results == nil {
		return false
	}
	if len(fn.Type.Params.List) != 2 || len(fn.Type.Results.List) != 2 {
		return false
	}
	if types.ExprString(fn.Type.Params.List[0].Type) != "context.Context" {
		return false
	}
	if !strings.HasPrefix(types.ExprString(fn.Type.Params.List[1].Type), "*") {
		return false
	}

	return types.ExprString(fn.Type.Results.List[1].Type) == "error" &&
		strings.HasPrefix(types.ExprString(fn.Type.Results.List[0].Type), "*")
}

// sameName is the id of an rpc: the method's own name, because the contract
// spells it the same and extract-proto puts that spelling in `provides`.
func sameName(name string) string { return name }

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
