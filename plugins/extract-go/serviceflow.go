package extractgo

import (
	"go/ast"
	"go/token"
	"go/types"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// serviceEndpoint is an execution root in a shared Go module. HTTP endpoints
// are public roots; gRPC handlers are continuation fragments which another
// service's client call can splice into an end-to-end flow.
type serviceEndpoint struct {
	kind       string
	method     string
	path       string
	label      string
	entrypoint string
	source     string
	line       int
	pkg        *pkg
	recvType   string
	fn         *ast.FuncDecl
}

func extractServiceFlows(root string, opts Options, b *plugin.Builder) ([]catalog.Flow, []catalog.RpcCall) {
	r := newFlowReader(root, flowOptions{
		context: opts.Context, svcID: serviceID(opts.Context, opts.Service), service: opts.Service,
		store: opts.Store, peers: opts.Peers, externals: opts.Externals, events: opts.Events, serviceStyle: true,
	}, b)

	var out []catalog.Flow
	for _, endpoint := range serviceEndpoints(root, opts.Scope) {
		d := newDraft()
		d.lane(r.serviceLane())
		if endpoint.kind == "http" {
			d.lane(catalog.Participant{ID: laneClient, Kind: catalog.ParticipantActor})
			d.add(catalog.Step{
				From: laneClient, To: r.opts.svcID, Kind: catalog.StepRPC,
				Label: endpoint.label, Line: at(endpoint.source, endpoint.line),
			})
		}
		r.walkBody(d, &scope{
			pkg: endpoint.pkg, key: endpoint.entrypoint,
			fields: fieldsOfStruct(endpoint.pkg, endpoint.recvType), imports: importsOf(endpoint.pkg),
			vars: map[string]domainRef{}, recv: receiverIdent(endpoint.fn), recvType: endpoint.recvType,
		}, endpoint.fn, 0)

		// A route that only panics or serializes a response is not an
		// architecture flow. A gRPC implementation with no downstream work is
		// likewise only the endpoint contract already described by proto.
		minimum := 0
		if endpoint.kind == "http" {
			minimum = 1
		}
		if len(d.steps) <= minimum {
			continue
		}

		name := endpoint.label
		slugged := opts.Service + "-" + serviceFlowSlug(endpoint.kind+"-"+name)
		flow := catalog.Flow{
			ID: "flow." + slugged, Slug: slugged, Name: name,
			Summary: "Source-derived " + endpoint.kind + " execution path for `" + name + "`.",
			Source:  endpoint.source, Owner: opts.Context, Participants: d.lanes, Steps: d.steps,
		}
		if endpoint.kind == "http" {
			flow.Trigger = &catalog.FlowTrigger{Kind: "http", Label: endpoint.label, Confidence: "high"}
		} else {
			flow.Trigger = &catalog.FlowTrigger{Kind: "unproven", Label: endpoint.label, Confidence: "high"}
			flow.EntryPoint = endpoint.entrypoint
		}
		out = append(out, flow)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out, r.consumes()
}

func mergeRPCCalls(left, right []catalog.RpcCall) []catalog.RpcCall {
	byID := map[string]catalog.RpcCall{}
	for _, call := range append(append([]catalog.RpcCall{}, left...), right...) {
		byID[call.ID] = call
	}
	out := make([]catalog.RpcCall, 0, len(byID))
	for _, call := range byID {
		out = append(out, call)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func serviceEndpoints(root, scope string) []serviceEndpoint {
	var out []serviceEndpoint
	owned := "internal/" + strings.Trim(scope, "/")
	for _, dir := range goPackageDirs(root, "internal") {
		if dir != owned && !strings.HasPrefix(dir, owned+"/") {
			continue
		}
		p, err := parsePkg(root, dir)
		if err != nil {
			continue
		}
		out = append(out, httpServiceEndpoints(p, dir)...)
		out = append(out, grpcServiceEndpoints(p, dir)...)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].kind != out[j].kind {
			return out[i].kind < out[j].kind
		}
		if out[i].label != out[j].label {
			return out[i].label < out[j].label
		}
		return out[i].entrypoint < out[j].entrypoint
	})
	return out
}

var httpRouteMethods = map[string]string{
	"Get": "GET", "Post": "POST", "Put": "PUT", "Patch": "PATCH", "Delete": "DELETE",
	"Head": "HEAD", "Options": "OPTIONS",
}

func httpServiceEndpoints(p *pkg, dir string) []serviceEndpoint {
	if path.Base(dir) != "http" {
		return nil
	}
	mounts := map[string]string{}
	for _, decl := range allMethods(p) {
		ast.Inspect(decl.fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "Mount" || len(call.Args) < 2 {
				return true
			}
			prefix, ok := stringLiteral(call.Args[0])
			if !ok {
				return true
			}
			factory, ok := call.Args[1].(*ast.CallExpr)
			if !ok {
				return true
			}
			fn, ok := factory.Fun.(*ast.SelectorExpr)
			if ok {
				mounts[fn.Sel.Name] = prefix
			}
			return true
		})
	}

	var out []serviceEndpoint
	for _, decl := range allMethods(p) {
		if decl.fn.Body == nil {
			continue
		}
		recv := receiverIdent(decl.fn)
		ast.Inspect(decl.fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || len(call.Args) < 2 {
				return true
			}
			method, route := httpRouteMethods[sel.Sel.Name]
			if !route {
				return true
			}
			routePath, ok := stringLiteral(call.Args[0])
			if !ok || !strings.HasPrefix(routePath, "/") {
				return true
			}
			handler, ok := call.Args[len(call.Args)-1].(*ast.SelectorExpr)
			if !ok {
				return true
			}
			owner, ok := handler.X.(*ast.Ident)
			if !ok || owner.Name != recv {
				return true
			}
			target := p.methods(decl.recvType)[handler.Sel.Name]
			if target == nil {
				return true
			}
			fullPath := joinHTTPPath(mounts[decl.fn.Name.Name], routePath)
			source, line := p.position(call.Pos())
			out = append(out, serviceEndpoint{
				kind: "http", method: method, path: fullPath, label: method + " " + fullPath,
				entrypoint: functionEntry(dir, decl.recvType, handler.Sel.Name), source: source, line: line,
				pkg: p, recvType: decl.recvType, fn: target,
			})
			return true
		})
	}
	return out
}

type methodDecl struct {
	recvType string
	fn       *ast.FuncDecl
}

func allMethods(p *pkg) []methodDecl {
	var out []methodDecl
	for _, file := range p.files {
		for _, raw := range file.Decls {
			fn, ok := raw.(*ast.FuncDecl)
			if !ok || fn.Recv == nil || len(fn.Recv.List) == 0 {
				continue
			}
			out = append(out, methodDecl{recvType: receiverName(fn.Recv.List[0].Type), fn: fn})
		}
	}
	return out
}

func grpcServiceEndpoints(p *pkg, dir string) []serviceEndpoint {
	base := path.Base(dir)
	if base != "rpc" && base != "grpc" {
		return nil
	}
	clients, _ := readClients(p)
	var out []serviceEndpoint
	for _, decl := range allMethods(p) {
		if !strings.HasSuffix(decl.recvType, "Server") || !isRpcHandler(decl.fn) {
			continue
		}
		serverStem := grpcServerStem(p, decl.recvType)
		id := ""
		for clientName, client := range clients {
			if strings.TrimSuffix(clientName, "Client") != serverStem {
				continue
			}
			if candidate := client.methods[decl.fn.Name.Name]; candidate != "" {
				id = candidate
				break
			}
		}
		if id == "" {
			continue
		}
		source, line := p.position(decl.fn.Pos())
		out = append(out, serviceEndpoint{
			kind: "grpc", label: id, entrypoint: functionEntry(dir, decl.recvType, decl.fn.Name.Name),
			source: source, line: line, pkg: p, recvType: decl.recvType, fn: decl.fn,
		})
	}
	return out
}

func grpcServerStem(p *pkg, recv string) string {
	for _, decl := range p.structs() {
		if decl.name != recv || decl.fields == nil || decl.fields.Fields == nil {
			continue
		}
		for _, field := range decl.fields.Fields.List {
			if len(field.Names) != 0 {
				continue
			}
			name := strings.TrimPrefix(typesString(field.Type), "*")
			if strings.HasPrefix(name, "Unimplemented") && strings.HasSuffix(name, "Server") {
				return strings.TrimSuffix(strings.TrimPrefix(name, "Unimplemented"), "Server")
			}
		}
	}
	return strings.TrimSuffix(recv, "Server")
}

func typesString(expr ast.Expr) string {
	return strings.TrimSpace(types.ExprString(expr))
}

func rpcImplementationEntries(root string) map[string]string {
	out := map[string]string{}
	ambiguous := map[string]bool{}
	for _, dir := range goPackageDirs(root, "internal") {
		p, err := parsePkg(root, dir)
		if err != nil {
			continue
		}
		for _, endpoint := range grpcServiceEndpoints(p, dir) {
			if ambiguous[endpoint.label] {
				continue
			}
			if existing := out[endpoint.label]; existing != "" && existing != endpoint.entrypoint {
				delete(out, endpoint.label)
				ambiguous[endpoint.label] = true
			} else if existing == "" {
				out[endpoint.label] = endpoint.entrypoint
			}
		}
	}
	return out
}

func fieldsOfStruct(p *pkg, name string) map[string]string {
	for _, decl := range p.structs() {
		if decl.name == name {
			return structFields(decl.fields)
		}
	}
	return map[string]string{}
}

func (r *flowReader) localMethod(current *pkg, declared string, imports map[string]string, method string) (*pkg, string, *ast.FuncDecl) {
	written := strings.TrimPrefix(declared, "*")
	selector, typeName, qualified := strings.Cut(written, ".")
	target := current
	if qualified {
		rel, ok := r.relDir(r.importPath(selector, imports))
		if !ok {
			return nil, "", nil
		}
		parsed, err := parsePkg(r.root, rel)
		if err != nil {
			return nil, "", nil
		}
		target = parsed
	} else {
		typeName = selector
	}
	return target, typeName, target.methods(typeName)[method]
}

func receiverField(expr *ast.SelectorExpr, recv string) (string, bool) {
	var parts []string
	var current ast.Expr = expr
	for {
		sel, ok := current.(*ast.SelectorExpr)
		if !ok {
			break
		}
		parts = append(parts, sel.Sel.Name)
		current = sel.X
	}
	ident, ok := current.(*ast.Ident)
	if !ok || ident.Name != recv || len(parts) == 0 {
		return "", false
	}
	return parts[len(parts)-1], true
}

func storeLike(field, declared string, imports map[string]string) bool {
	lower := strings.ToLower(field + " " + declared)
	if strings.Contains(lower, "store") || strings.Contains(lower, "repository") || strings.Contains(lower, "repo") {
		return true
	}
	selector, _, ok := strings.Cut(strings.TrimPrefix(declared, "*"), ".")
	if !ok {
		return false
	}
	importPath := strings.ToLower(imports[selector])
	return strings.Contains(importPath, "/store") || strings.Contains(importPath, "/repository")
}

func functionEntry(dir, recv, method string) string {
	name := recv + "." + method
	if dir == "" || dir == "." {
		return name
	}
	return dir + ":" + name
}

func stringLiteral(expr ast.Expr) (string, bool) {
	lit, ok := expr.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	value, err := strconv.Unquote(lit.Value)
	return value, err == nil
}

func joinHTTPPath(prefix, suffix string) string {
	if prefix == "" {
		return suffix
	}
	if suffix == "/" {
		return strings.TrimSuffix(prefix, "/") + "/"
	}
	return strings.TrimSuffix(prefix, "/") + "/" + strings.TrimPrefix(suffix, "/")
}

func serviceFlowSlug(value string) string {
	var b strings.Builder
	separator := false
	for _, r := range strings.ToLower(value) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			if separator && b.Len() > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r)
			separator = false
		} else {
			separator = true
		}
	}
	return strings.Trim(b.String(), "-")
}
