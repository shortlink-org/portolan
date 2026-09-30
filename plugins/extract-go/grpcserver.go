package extractgo

import (
	"go/ast"
	"sort"
	"strings"
)

// A gRPC server is recognised by what protoc-gen-go-grpc makes its author
// write, not by the directory it sits in:
//
//	type Handler struct {
//		pricingv1.UnimplementedPricingServer
//		...
//	}
//
//	pricingv1.RegisterPricingServer(srv, handler.NewHandler(...))
//
// The generated Register<X>Server takes an implementation of <X>Server, and
// that interface asks for mustEmbedUnimplemented<X>Server - so a server
// embeds Unimplemented<X>Server (or opts out through Unsafe<X>Server), and
// either the embed or the registration names the service. The package that
// declares the embedded type, or the Register function, is the generated
// one, and its client constants name each rpc.

// grpcServer is one implementation: the service it serves as the generated
// code spells it, and the generated package that says what its rpcs are
// called.
type grpcServer struct {
	stem      string
	generated *pkg
}

// grpcRegistration is one Register<X>Server call, as the implementation's
// type key sees it: which service, from which generated package.
type grpcRegistration struct {
	stem       string
	importPath string
}

// grpcServiceStem reads a generated server type's name back to the service:
// UnimplementedPricingServer and UnsafePricingServer are Pricing.
func grpcServiceStem(name string) (string, bool) {
	for _, prefix := range []string{"Unimplemented", "Unsafe"} {
		if rest, ok := strings.CutPrefix(name, prefix); ok {
			stem, ok := strings.CutSuffix(rest, "Server")
			if ok && stem != "" {
				return stem, true
			}
		}
	}

	return "", false
}

// grpcServers is every server implementation p declares, by type name.
func grpcServers(p *pkg) map[string]grpcServer {
	out := map[string]grpcServer{}
	for _, decl := range p.structs() {
		if decl.fields == nil || decl.fields.Fields == nil {
			continue
		}
		for _, field := range decl.fields.Fields.List {
			if len(field.Names) != 0 {
				continue
			}
			written := strings.TrimPrefix(typesString(field.Type), "*")
			selector, name, qualified := strings.Cut(written, ".")
			if !qualified {
				name = selector
			}
			stem, ok := grpcServiceStem(name)
			if !ok {
				continue
			}
			generated := p
			if qualified {
				generated = p.importedPkg(decl.file, selector)
			}
			if generated != nil {
				out[decl.name] = grpcServer{stem: stem, generated: generated}
				break
			}
		}
	}

	// A type registered without embedding the generated one directly - an
	// older generator, or an embed one struct further down - is named by
	// the call that registers it.
	info := p.types()
	if info == nil || len(p.files) == 0 {
		return out
	}
	importPath := info.importPath(p.files[0])
	for _, decl := range p.structs() {
		if _, known := out[decl.name]; known {
			continue
		}
		registered := info.grpcRegistered[importPath+"."+decl.name]
		if len(registered) != 1 {
			// Registered as two services, it is two servers at once, and
			// one endpoint cannot say which contract a method answers.
			continue
		}
		if generated := p.pkgAt(registered[0].importPath); generated != nil {
			out[decl.name] = grpcServer{stem: registered[0].stem, generated: generated}
		}
	}

	return out
}

// readGRPCRegistrations reads every Register<X>Server(server, impl) call in
// the tree, keyed by the type key of impl: a composite literal, `new(T)`, a
// constructor whose result is declared, or a local assigned any of those.
// An implementation whose type cannot be read is left out.
func (t *typeInfo) readGRPCRegistrations() map[string][]grpcRegistration {
	out := map[string][]grpcRegistration{}
	seen := map[string]bool{}
	for _, fn := range t.SortedFunctions() {
		if fn.File.Generated {
			continue
		}
		ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) != 2 {
				return true
			}
			name, importPath := "", fn.File.Pkg
			switch callee := call.Fun.(type) {
			case *ast.Ident:
				name = callee.Name
			case *ast.SelectorExpr:
				base, ok := callee.X.(*ast.Ident)
				if !ok || fn.File.Imports[base.Name] == "" {
					return true
				}
				name, importPath = callee.Sel.Name, fn.File.Imports[base.Name]
			}
			rest, ok := strings.CutPrefix(name, "Register")
			if !ok {
				return true
			}
			stem, ok := strings.CutSuffix(rest, "Server")
			if !ok || stem == "" {
				return true
			}
			impl := t.typeOf(call.Args[1], fn)
			if !t.concrete(impl) {
				return true
			}
			key := impl + "|" + stem + "|" + importPath
			if !seen[key] {
				seen[key] = true
				out[impl] = append(out[impl], grpcRegistration{stem: stem, importPath: importPath})
			}
			return true
		})
	}
	for impl := range out {
		sort.Slice(out[impl], func(i, j int) bool { return out[impl][i].stem < out[impl][j].stem })
	}

	return out
}
