package main

import (
	"go/ast"
	"go/token"
	"go/types"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// A call to another service is read off the generated client, because that is
// where the fact is written down: protoc-gen-go-grpc emits one constant per
// rpc holding the full method name, and the client interface beside it. The
// use case never names the proto - it holds a port - so the chain is port →
// provider → adapter → client, and every link of it is in the tree.

// grpcClient is one generated client interface and the rpcs it carries.
type grpcClient struct {
	// pkg is the proto package, "risk.v1": the key the manifest's peers map
	// uses to say which service answers to it.
	pkg string
	// methods maps an rpc name to the call id, "risk.v1.RiskService/Assess".
	methods map[string]string
	// source is the generated file the names were read from.
	source string
}

// readClients finds every client interface a package declares, keyed by the
// interface's name ("RiskServiceClient"), from its *_FullMethodName constants.
func readClients(pkg *pkg) map[string]grpcClient {
	out := map[string]grpcClient{}

	for _, file := range pkg.files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, spec := range gen.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range value.Names {
					if i >= len(value.Values) {
						continue
					}
					lit, ok := value.Values[i].(*ast.BasicLit)
					if !ok || lit.Kind != token.STRING {
						continue
					}
					full, err := strconv.Unquote(lit.Value)
					if err != nil {
						continue
					}
					goService, service, method, ok := splitFullMethod(name.Name, full)
					if !ok {
						continue
					}

					key := goService + "Client"
					client, known := out[key]
					if !known {
						client = grpcClient{
							pkg:     lastDotPrefix(service),
							methods: map[string]string{},
							source:  pkg.paths[file],
						}
					}
					client.methods[method] = service + "/" + method
					out[key] = client
				}
			}
		}
	}

	return out
}

// splitFullMethod reads `RiskService_Assess_FullMethodName = "/risk.v1.RiskService/Assess"`
// into the Go service name, the proto service name and the rpc.
func splitFullMethod(constName, full string) (goService, service, method string, ok bool) {
	if !strings.HasSuffix(constName, "_FullMethodName") || !strings.HasPrefix(full, "/") {
		return "", "", "", false
	}
	service, method, found := strings.Cut(full[1:], "/")
	if !found || service == "" || method == "" || strings.Contains(method, "/") {
		return "", "", "", false
	}
	goService, ok = strings.CutSuffix(constName, "_"+method+"_FullMethodName")
	if !ok || goService == "" {
		return "", "", "", false
	}

	return goService, service, method, true
}

// lastDotPrefix is "risk.v1" for "risk.v1.RiskService".
func lastDotPrefix(name string) string {
	if i := strings.LastIndex(name, "."); i >= 0 {
		return name[:i]
	}

	return name
}

// clientPkg reads the clients of a package by import path, once.
func (r *flowReader) clientPkg(importPath string) map[string]grpcClient {
	if cached, ok := r.clients[importPath]; ok {
		return cached
	}

	var out map[string]grpcClient
	if rel, ok := r.relDir(importPath); ok {
		if pkg, err := parsePkg(r.root, rel); err == nil {
			out = readClients(pkg)
		}
	}
	r.clients[importPath] = out

	return out
}

// relDir maps an import path inside this module to a directory under root.
// Anything outside the module is not in the tree, and this reads the tree.
func (r *flowReader) relDir(importPath string) (string, bool) {
	if r.module == "" {
		return "", false
	}

	return strings.CutPrefix(importPath, r.module+"/")
}

// clientOf resolves a type written as `riskpb.RiskServiceClient` to the client
// it names, or says the type is not a generated client.
func (r *flowReader) clientOf(declared string, imports map[string]string) (grpcClient, bool) {
	selector, name, found := strings.Cut(strings.TrimPrefix(declared, "*"), ".")
	if !found {
		return grpcClient{}, false
	}
	client, ok := r.clientPkg(imports[selector])[name]

	return client, ok
}

// rpcHop is one call on a port that turns out to be another service's rpc.
type rpcHop struct {
	client grpcClient
	method string
}

// clientCalls says which rpcs a call on a port amounts to: none when the port
// is not a client, one when the port IS the generated client, and whatever the
// adapter's method calls when the port is a local interface bound to one in
// assembly.
func (r *flowReader) clientCalls(s *scope, declared, method string) []rpcHop {
	if client, ok := r.clientOf(declared, s.imports); ok {
		if _, known := client.methods[method]; !known {
			r.b.Warn(s.key, "port `"+declared+"` is a generated client with no rpc named "+method+"; the call is left out of the flow")

			return nil
		}

		return []rpcHop{{client: client, method: method}}
	}

	binding, ok := r.adapters[s.key+"."+declared]
	if !ok {
		return nil
	}

	return r.adapterCalls(s.key, declared, binding, method)
}

// adapterCalls reads the provider that binds a port to a client, follows it to
// the adapter type it builds, and reads which rpcs the adapter's method runs.
func (r *flowReader) adapterCalls(key, declared string, binding adapterDecl, method string) []rpcHop {
	var client grpcClient
	var clientType string
	for _, param := range params(binding.fn) {
		written := types.ExprString(param)
		if c, ok := r.clientOf(written, binding.imports); ok {
			client, clientType = c, strings.TrimPrefix(written, "*")

			break
		}
	}
	if clientType == "" {
		// A provider that builds the port out of something other than a
		// client is a binding of a different kind, and not one this can
		// follow to another service.
		return nil
	}

	adapter, adapterPkg, ok := r.adapterOf(binding)
	if !ok {
		r.b.Warn(key, "port `"+declared+"` is bound to a client of "+client.pkg+" but the provider's result could not be followed to a type; its calls are left out of the flow")

		return nil
	}

	fn := adapterPkg.methods(adapter)[method]
	if fn == nil {
		r.b.Warn(key, "port `"+declared+"` is adapted by "+adapter+", which has no method "+method+"; the call is left out of the flow")

		return nil
	}

	// The field of the adapter that holds the client, by name, so a call on it
	// can be told apart from a call on anything else the adapter holds.
	fields := map[string]string{}
	for _, decl := range adapterPkg.structs() {
		if decl.name == adapter {
			fields = structFields(decl.fields)
		}
	}
	imports := importsOf(adapterPkg)
	recv := receiverIdent(fn)

	var out []rpcHop
	seen := map[string]bool{}
	for _, site := range callSites(fn) {
		selector, ok := site.call.Fun.(*ast.SelectorExpr)
		if !ok {
			continue
		}
		inner, ok := selector.X.(*ast.SelectorExpr)
		if !ok {
			continue
		}
		owner, ok := inner.X.(*ast.Ident)
		if !ok || owner.Name != recv {
			continue
		}
		held, ok := r.clientOf(fields[inner.Sel.Name], imports)
		if !ok || held.pkg != client.pkg {
			continue
		}
		rpc := selector.Sel.Name
		if _, known := held.methods[rpc]; !known || seen[rpc] {
			continue
		}
		seen[rpc] = true
		out = append(out, rpcHop{client: held, method: rpc})
	}

	if len(out) == 0 {
		r.b.Warn(key, "port `"+declared+"` is adapted by "+adapter+"."+method+", which calls no rpc of the client; the call is left out of the flow")
	}

	return out
}

// adapterOf follows a provider's return to the type it builds: a literal of a
// type declared beside it, or a constructor in another package of this module.
func (r *flowReader) adapterOf(binding adapterDecl) (string, *pkg, bool) {
	expr := returnedExpr(binding.fn)
	if expr == nil {
		return "", nil, false
	}
	if unary, ok := expr.(*ast.UnaryExpr); ok && unary.Op == token.AND {
		expr = unary.X
	}

	switch x := expr.(type) {
	case *ast.CompositeLit:
		return r.typeIn(x.Type, binding)
	case *ast.CallExpr:
		selector, ok := x.Fun.(*ast.SelectorExpr)
		if !ok {
			return "", nil, false
		}
		owner, ok := selector.X.(*ast.Ident)
		if !ok {
			return "", nil, false
		}
		rel, ok := r.relDir(binding.imports[owner.Name])
		if !ok {
			return "", nil, false
		}
		pkg, err := parsePkg(r.root, rel)
		if err != nil {
			return "", nil, false
		}
		for _, file := range pkg.files {
			for _, decl := range file.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok || fn.Recv != nil || fn.Name.Name != selector.Sel.Name {
					continue
				}
				if fn.Type.Results == nil || len(fn.Type.Results.List) == 0 {
					return "", nil, false
				}
				name := strings.TrimPrefix(types.ExprString(fn.Type.Results.List[0].Type), "*")
				if strings.Contains(name, ".") {
					return "", nil, false
				}

				return name, pkg, true
			}
		}
	}

	return "", nil, false
}

// typeIn resolves the type of a composite literal: `adapter{}` is in the
// provider's own package, `risk.Client{}` in an imported one.
func (r *flowReader) typeIn(expr ast.Expr, binding adapterDecl) (string, *pkg, bool) {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name, binding.pkg, true
	case *ast.SelectorExpr:
		owner, ok := t.X.(*ast.Ident)
		if !ok {
			return "", nil, false
		}
		rel, ok := r.relDir(binding.imports[owner.Name])
		if !ok {
			return "", nil, false
		}
		pkg, err := parsePkg(r.root, rel)
		if err != nil {
			return "", nil, false
		}

		return t.Sel.Name, pkg, true
	}

	return "", nil, false
}

// returnedExpr is the single value of the function's last return.
func returnedExpr(fn *ast.FuncDecl) ast.Expr {
	if fn == nil || fn.Body == nil || len(fn.Body.List) == 0 {
		return nil
	}
	ret, ok := fn.Body.List[len(fn.Body.List)-1].(*ast.ReturnStmt)
	if !ok || len(ret.Results) != 1 {
		return nil
	}

	return ret.Results[0]
}

// peerLane is the lane a call to another service lands in, and what the step
// can claim about it. The manifest says which service answers to a proto
// package; without that line the far end is a package name, which is not a
// thing the catalog has, and the step says so rather than guessing.
func (r *flowReader) peerLane(d *flowDraft, client grpcClient) (lane, peer string, status catalog.Status) {
	if service, ok := r.opts.peers[client.pkg]; ok {
		context, _, _ := strings.Cut(service, ".")

		return d.lane(catalog.Participant{ID: service, Kind: catalog.ParticipantService, Context: &context}), service, catalog.StatusDeclared
	}

	if !r.warnedPeer[client.pkg] {
		r.b.Warn(r.opts.svcID, "calls "+client.pkg+" and the manifest names no peer for that package; add it under `peers` to say which service answers, until then the calls are unresolved")
		r.warnedPeer[client.pkg] = true
	}

	return d.lane(catalog.Participant{ID: client.pkg, Kind: catalog.ParticipantUnknown}), client.pkg, catalog.StatusUnresolved
}
