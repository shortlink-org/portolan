package extractgo

import (
	"go/ast"
	"go/types"
	"path"
	"reflect"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/internal/goscan"
)

// routeSkip is a call that registers an HTTP route this reader could not turn
// into an endpoint. Every one becomes a warning: a route that silently
// vanishes reads as a service with fewer endpoints than it has.
type routeSkip struct {
	ref    string
	route  string
	reason string
}

func (s routeSkip) message() string {
	return "http.route-skipped: " + s.route + " " + s.reason + "; it is left out of the flows"
}

// routeTarget is the function a registration hands a request to.
type routeTarget struct {
	p    *pkg
	dir  string
	recv string
	fn   *ast.FuncDecl
}

// routerPrefixes is every path prefix a router value can carry, or why it
// could not be read.
type routerPrefixes struct {
	values []string
	reason string
}

// mountSite is a router built in a function and mounted under a path later in
// the same function: its routes sit under that path however early they were
// registered.
type mountSite struct {
	router ast.Expr
	path   ast.Expr
}

// routeReader reads HTTP registrations across a module. Prefixes travel
// between functions two ways: a function whose result is mounted (chi Mount)
// registers under the mount path, and a router handed to a function as an
// argument (a gin group, a chi sub-router) carries its prefix into that
// parameter. Both are settled over the whole module before routes are read,
// so a registration in one package sees a mount written in another.
type routeReader struct {
	root  string
	tree  *goscan.Tree
	index *goscan.Index
	funcs map[*ast.FuncDecl]*goscan.Function
	pkgs  map[string]*pkg

	mounted map[string]map[string]bool
	params  map[string]map[int]map[string]bool
	// next is what the pass under way found; settle compares it with the
	// tables the pass read from.
	nextMounted map[string]map[string]bool
	nextParams  map[string]map[int]map[string]bool

	closures map[*ast.FuncLit]*ast.FuncDecl
	names    map[*ast.FuncDecl]map[*ast.FuncLit]string
	kinds    map[*ast.FuncDecl]map[string]string

	emit      bool
	endpoints []serviceEndpoint
	skipped   []routeSkip
}

func serviceRoutes(root, scope string, indexes ...*goscan.Tree) ([]serviceEndpoint, []routeSkip) {
	tree, err := goscan.PackageIndex(root, ".", indexes...)
	if err != nil {
		return nil, nil
	}
	rr := &routeReader{
		root: root, tree: tree, pkgs: map[string]*pkg{},
		mounted: map[string]map[string]bool{}, params: map[string]map[int]map[string]bool{},
		closures: map[*ast.FuncLit]*ast.FuncDecl{}, names: map[*ast.FuncDecl]map[*ast.FuncLit]string{},
		kinds: map[*ast.FuncDecl]map[string]string{},
	}
	owned := "internal/" + strings.Trim(scope, "/")
	var all, mine []string
	for _, dir := range goPackageDirs(root, ".", indexes...) {
		if rr.pkg(dir) == nil {
			continue
		}
		all = append(all, dir)
		if scope == "" || dir == owned || strings.HasPrefix(dir, owned+"/") {
			mine = append(mine, dir)
		}
	}
	rr.settle(all)

	var out []serviceEndpoint
	rr.emit = true
	for _, dir := range mine {
		rr.readPkg(dir)
		out = append(out, grpcServiceEndpoints(rr.pkgs[dir], dir)...)
	}
	seen := map[string]bool{}
	for _, endpoint := range rr.endpoints {
		key := endpoint.label + "|" + endpoint.entrypoint
		if !seen[key] {
			seen[key] = true
			out = append(out, endpoint)
		}
	}
	return out, rr.skipped
}

func (rr *routeReader) pkg(dir string) *pkg {
	if p, ok := rr.pkgs[dir]; ok {
		return p
	}
	p, err := parsePkg(rr.root, dir, rr.tree)
	if err != nil {
		p = nil
	}
	rr.pkgs[dir] = p
	return p
}

// idx is the declaration index, built the first time a value has to be
// followed past a literal.
func (rr *routeReader) idx() *goscan.Index {
	if rr.index == nil {
		rr.index = goscan.NewIndex(rr.tree)
		rr.funcs = map[*ast.FuncDecl]*goscan.Function{}
		for _, fn := range rr.index.Functions {
			rr.funcs[fn.Decl] = fn
		}
	}
	return rr.index
}

func (rr *routeReader) function(decl *ast.FuncDecl) *goscan.Function {
	rr.idx()
	return rr.funcs[decl]
}

func (rr *routeReader) entry(fn *goscan.Function) string {
	return functionEntry(path.Dir(fn.File.Name), receiverTypeName(fn.Decl), fn.Decl.Name.Name)
}

// settle reads every function for mounts and routers handed on until the
// prefixes stop changing. A chain of mounts one function deep per pass is
// settled in as many passes; four is deeper than routers are nested.
func (rr *routeReader) settle(dirs []string) {
	for pass := 0; pass < 4; pass++ {
		rr.nextMounted, rr.nextParams = map[string]map[string]bool{}, map[string]map[int]map[string]bool{}
		for _, dir := range dirs {
			rr.readPkg(dir)
		}
		if reflect.DeepEqual(rr.nextMounted, rr.mounted) && reflect.DeepEqual(rr.nextParams, rr.params) {
			return
		}
		rr.mounted, rr.params = rr.nextMounted, rr.nextParams
	}
}

func (rr *routeReader) readPkg(dir string) {
	p := rr.pkgs[dir]
	if p == nil {
		return
	}
	echo := false
	for _, imported := range importsOf(p) {
		if strings.HasPrefix(imported, "github.com/labstack/echo") {
			echo = true
		}
	}
	generated := map[*ast.File]bool{}
	for _, file := range rr.tree.PackageFiles(dir) {
		generated[file.Node] = file.Generated
	}
	for _, file := range p.files {
		for _, raw := range file.Decls {
			if fn, ok := raw.(*ast.FuncDecl); ok && fn.Body != nil {
				rr.readFunc(p, dir, fn, echo, generated[file])
			}
		}
	}
}

func (rr *routeReader) readFunc(p *pkg, dir string, fn *ast.FuncDecl, echo, generated bool) {
	kinds := rr.kinds[fn]
	if kinds == nil {
		kinds = httpRouterNames(p, fn)
		rr.kinds[fn] = kinds
	}
	sc := &routeScope{rr: rr, p: p, dir: dir, owner: fn, echo: echo, generated: generated, kinds: map[string]string{}, bound: map[string]routerPrefixes{}}
	for key, value := range kinds {
		sc.kinds[key] = value
	}
	entry := functionEntry(dir, receiverTypeName(fn), fn.Name.Name)
	sc.base = sortedKeys(rr.mounted[entry])
	if len(sc.base) == 0 {
		sc.base = []string{""}
	}
	for i, name := range paramNames(fn) {
		if prefixes := rr.params[entry][i]; len(prefixes) > 0 && name != "" {
			sc.bound[name] = routerPrefixes{values: sortedKeys(prefixes)}
		}
	}
	sc.mountedLocal = mountedLocals(fn)
	sc.walk(fn.Body)
}

func (rr *routeReader) record(into map[string]map[string]bool, key string, values []string) {
	if into[key] == nil {
		into[key] = map[string]bool{}
	}
	for _, value := range values {
		into[key][value] = true
	}
}

// routeScope is one function being read, and what its router values carry.
type routeScope struct {
	rr    *routeReader
	p     *pkg
	dir   string
	owner *ast.FuncDecl
	echo  bool
	// generated is whether the function is in a generated file. A route
	// there that cannot be read is described by the contract it was
	// generated from, and is passed over without a warning.
	generated bool
	// kinds is what httpRouterNames knows: "net/http" or "verbs" by
	// expression. bound is a router whose prefix is known: a group, a
	// sub-router's callback parameter, a parameter handed a group.
	kinds        map[string]string
	bound        map[string]routerPrefixes
	base         []string
	mountedLocal map[string]mountSite
}

func (sc *routeScope) child() *routeScope {
	next := *sc
	next.kinds = map[string]string{}
	for key, value := range sc.kinds {
		next.kinds[key] = value
	}
	next.bound = map[string]routerPrefixes{}
	for key, value := range sc.bound {
		next.bound[key] = value
	}
	return &next
}

func (sc *routeScope) function() *goscan.Function { return sc.rr.function(sc.owner) }

func (sc *routeScope) walk(body ast.Node) {
	ast.Inspect(body, func(node ast.Node) bool {
		switch value := node.(type) {
		case *ast.AssignStmt:
			sc.bind(value.Lhs, value.Rhs)
		case *ast.ValueSpec:
			lhs := make([]ast.Expr, 0, len(value.Names))
			for _, name := range value.Names {
				lhs = append(lhs, name)
			}
			sc.bind(lhs, value.Values)
		case *ast.FuncLit:
			sc.routerParams(value)
		case *ast.CallExpr:
			return sc.call(value)
		}
		return true
	})
}

// routerParams marks a closure's parameters typed as a router of a known
// package: `func(r chi.Router)` handed to anything.
func (sc *routeScope) routerParams(lit *ast.FuncLit) {
	if lit.Type.Params == nil {
		return
	}
	imports := importsOf(sc.p)
	for _, field := range lit.Type.Params.List {
		alias, _, _ := strings.Cut(strings.TrimPrefix(types.ExprString(field.Type), "*"), ".")
		if !routerPackage(imports[alias]) {
			continue
		}
		for _, name := range field.Names {
			if _, bound := sc.bound[name.Name]; !bound {
				sc.kinds[name.Name] = "verbs"
			}
		}
	}
}

func routerPackage(importPath string) bool {
	switch importPath {
	case "github.com/go-chi/chi/v5", "github.com/go-chi/chi", "github.com/gin-gonic/gin", "github.com/labstack/echo/v4":
		return true
	}
	return false
}

// bind records a router derived from another: `v1 := r.Group("/v1")`,
// `admin := r.With(auth)`.
func (sc *routeScope) bind(lhs, rhs []ast.Expr) {
	if len(lhs) != len(rhs) {
		return
	}
	for i, value := range rhs {
		call, ok := value.(*ast.CallExpr)
		if !ok {
			continue
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || !derivesRouter(sel.Sel.Name, call) || sc.router(sel.X) == "" {
			continue
		}
		sc.bound[types.ExprString(lhs[i])] = sc.prefixes(call, 0)
	}
}

// derivesRouter is whether a call on a router returns a router under a
// prefix: chi With, gin/echo Group(prefix).
func derivesRouter(name string, call *ast.CallExpr) bool {
	switch name {
	case "With":
		return true
	case "Group":
		return len(call.Args) > 0 && !isFuncLit(call.Args[0])
	}
	return false
}

func isFuncLit(expr ast.Expr) bool {
	_, ok := expr.(*ast.FuncLit)
	return ok
}

// router is what kind of router an expression is: "net/http", "verbs", or
// empty when it is not known to be one.
func (sc *routeScope) router(x ast.Expr) string {
	key := types.ExprString(x)
	if _, ok := sc.bound[key]; ok {
		return "verbs"
	}
	if kind := sc.kinds[key]; kind != "" {
		return kind
	}
	if _, ok := sc.mountedLocal[key]; ok {
		return "verbs"
	}
	if call, ok := x.(*ast.CallExpr); ok {
		if sel, ok := call.Fun.(*ast.SelectorExpr); ok && derivesRouter(sel.Sel.Name, call) {
			return sc.router(sel.X)
		}
	}
	return ""
}

// prefixes is every path prefix a router expression carries.
func (sc *routeScope) prefixes(x ast.Expr, depth int) routerPrefixes {
	if depth > 8 {
		return routerPrefixes{reason: "is registered on routers nested deeper than this reader follows"}
	}
	key := types.ExprString(x)
	if bound, ok := sc.bound[key]; ok {
		return bound
	}
	if site, ok := sc.mountedLocal[key]; ok {
		return sc.under(sc.prefixes(site.router, depth+1), site.path)
	}
	if call, ok := x.(*ast.CallExpr); ok {
		if sel, ok := call.Fun.(*ast.SelectorExpr); ok && derivesRouter(sel.Sel.Name, call) {
			if sel.Sel.Name == "With" {
				return sc.prefixes(sel.X, depth+1)
			}
			return sc.under(sc.prefixes(sel.X, depth+1), call.Args[0])
		}
	}
	return routerPrefixes{values: sc.base}
}

func (sc *routeScope) under(parent routerPrefixes, prefix ast.Expr) routerPrefixes {
	if parent.reason != "" {
		return parent
	}
	rels := sc.strings(prefix)
	if len(rels) == 0 {
		return routerPrefixes{reason: "sits under the prefix " + types.ExprString(prefix) + ", which is not a literal, a constant or a concatenation of them"}
	}
	var out []string
	for _, base := range parent.values {
		for _, rel := range rels {
			out = append(out, joinRoutePath(base, rel))
		}
	}
	return routerPrefixes{values: dedupeSorted(out)}
}

// strings is every string a path expression is worth: a literal, a constant
// of the module, a concatenation of those, a local or a parameter followed
// to them. Empty when it is none of those; never a guess.
func (sc *routeScope) strings(expr ast.Expr) []string {
	if value, ok := stringLiteral(expr); ok {
		return []string{value}
	}
	fn := sc.function()
	if fn == nil {
		return nil
	}
	var out []string
	for _, resolved := range sc.rr.idx().Resolve(expr, fn, 0, map[string]bool{}) {
		out = append(out, resolved.Value)
	}
	return dedupeSorted(out)
}

func (sc *routeScope) call(call *ast.CallExpr) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		sc.passes(call)
		return true
	}
	kind := sc.router(sel.X)
	clear := kind != ""
	loose := !clear && path.Base(sc.dir) == "http"
	if !clear && !loose {
		sc.passes(call)
		return true
	}
	switch sel.Sel.Name {
	case "Route":
		if len(call.Args) == 2 {
			if lit, ok := call.Args[1].(*ast.FuncLit); ok {
				sc.route(call, sc.under(sc.prefixes(sel.X, 0), call.Args[0]), lit, clear)
				return false
			}
		}
	case "Group":
		if len(call.Args) == 1 {
			if lit, ok := call.Args[0].(*ast.FuncLit); ok {
				sc.route(call, sc.prefixes(sel.X, 0), lit, clear)
				return false
			}
		}
	case "Mount":
		sc.mount(call, sel, clear)
		return true
	}
	sc.passes(call)
	if sc.rr.emit {
		sc.register(call, sel, kind, clear)
	}
	return true
}

// route reads a chi sub-router's callback, Route(prefix, fn) or Group(fn),
// with its router parameter bound to the prefix.
func (sc *routeScope) route(call *ast.CallExpr, prefixes routerPrefixes, lit *ast.FuncLit, clear bool) {
	if prefixes.reason != "" {
		if clear {
			sc.skip(call, sel(call)+" "+types.ExprString(call.Args[0]), "routes "+prefixes.reason)
		}
		return
	}
	next := sc.child()
	if lit.Type.Params != nil && len(lit.Type.Params.List) > 0 && len(lit.Type.Params.List[0].Names) > 0 {
		next.bound[lit.Type.Params.List[0].Names[0].Name] = prefixes
	}
	next.walk(lit.Body)
}

func sel(call *ast.CallExpr) string {
	if s, ok := call.Fun.(*ast.SelectorExpr); ok {
		return s.Sel.Name
	}
	return types.ExprString(call.Fun)
}

// mount reads chi Mount(prefix, handler): a function that builds the mounted
// router registers every route under the prefix. A router built in this
// function is bound by mountedLocals before the walk.
func (sc *routeScope) mount(call *ast.CallExpr, selector *ast.SelectorExpr, clear bool) {
	if len(call.Args) < 2 {
		return
	}
	desc := "Mount " + types.ExprString(call.Args[0])
	under := sc.under(sc.prefixes(selector.X, 0), call.Args[0])
	if under.reason != "" {
		if clear && sc.rr.emit {
			sc.skip(call, desc, under.reason)
		}
		return
	}
	target := call.Args[1]
	if sc.router(target) != "" {
		return
	}
	factory := sc.factoryOf(target)
	if factory == nil {
		if clear && sc.rr.emit {
			sc.skip(call, desc, "mounts "+types.ExprString(target)+", which could not be followed to a function of this module that builds it")
		}
		return
	}
	if !sc.rr.emit {
		sc.rr.record(sc.rr.nextMounted, sc.rr.entry(factory), under.values)
	}
}

// factoryOf is the one function a mounted handler is built by: the call
// itself, or the call a local was assigned from.
func (sc *routeScope) factoryOf(expr ast.Expr) *goscan.Function {
	switch value := expr.(type) {
	case *ast.CallExpr:
		return sc.callee(value)
	case *ast.Ident:
		if fn := sc.function(); fn != nil {
			if given, ok := sc.rr.idx().AssignedTo(fn, value.Name); ok && given.Index == 0 {
				if call, ok := given.Expr.(*ast.CallExpr); ok {
					return sc.callee(call)
				}
			}
		}
	}
	return nil
}

// callee is the one function of the module a call lands on. A method whose
// receiver the index cannot type still resolves when its package declares
// exactly one function of that name.
func (sc *routeScope) callee(call *ast.CallExpr) *goscan.Function {
	if fn := sc.function(); fn != nil {
		callees := sc.rr.idx().Callees(call, fn)
		if len(callees) == 1 {
			return callees[0]
		}
		if len(callees) > 1 {
			return nil
		}
	}
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return nil
	}
	if alias, ok := selector.X.(*ast.Ident); ok && importsOf(sc.p)[alias.Name] != "" {
		return nil
	}
	var found *ast.FuncDecl
	for _, decl := range allFunctions(sc.p) {
		if decl.recvType != "" && decl.fn.Name.Name == selector.Sel.Name {
			if found != nil {
				return nil
			}
			found = decl.fn
		}
	}
	if found == nil {
		return nil
	}
	return sc.rr.function(found)
}

// passes records a router handed to a function of the module: the callee's
// parameter carries the router's prefixes.
func (sc *routeScope) passes(call *ast.CallExpr) {
	if sc.rr.emit || len(call.Args) == 0 {
		return
	}
	var callee *goscan.Function
	for i, arg := range call.Args {
		if kind := sc.router(arg); kind == "" || types.ExprString(arg) == "http" {
			continue
		}
		prefixes := sc.prefixes(arg, 0)
		if prefixes.reason != "" {
			continue
		}
		if callee == nil {
			if callee = sc.callee(call); callee == nil {
				return
			}
		}
		if i >= len(callee.Params) {
			continue
		}
		entry := sc.rr.entry(callee)
		if sc.rr.nextParams[entry] == nil {
			sc.rr.nextParams[entry] = map[int]map[string]bool{}
		}
		if sc.rr.nextParams[entry][i] == nil {
			sc.rr.nextParams[entry][i] = map[string]bool{}
		}
		for _, value := range prefixes.values {
			sc.rr.nextParams[entry][i][value] = true
		}
	}
}

// register reads one route registration. clear is whether the receiver is
// known to be a router; a registration read only by the `http` package
// convention is taken when it resolves and passed over quietly when it does
// not, since there the call may be anything with a Get method.
func (sc *routeScope) register(call *ast.CallExpr, selector *ast.SelectorExpr, kind string, clear bool) {
	name, args := selector.Sel.Name, call.Args
	method, pathArg, handlerArg, pattern := "", 0, len(args)-1, false
	switch {
	case (name == "HandleFunc" || name == "Handle") && len(args) == 2 && clear:
		pattern = true
	case httpRouteMethods[name] != "" && len(args) >= 2 && (kind == "verbs" || !clear):
		method = httpRouteMethods[name]
		if sc.echo {
			handlerArg = 1
		}
	case name == "Any" && kind == "verbs" && len(args) >= 2:
		method = "ANY"
		if sc.echo {
			handlerArg = 1
		}
	case (name == "Method" || name == "MethodFunc" || name == "Handle") && kind == "verbs" && len(args) >= 3:
		pathArg = 1
		verbs := sc.strings(args[0])
		if len(verbs) != 1 {
			sc.skip(call, name+" "+types.ExprString(args[1]), "names its method as "+types.ExprString(args[0])+", which is not one literal or constant")
			return
		}
		method = strings.ToUpper(verbs[0])
	default:
		return
	}
	desc := method
	if pattern {
		desc = name
	}
	desc += " " + types.ExprString(args[pathArg])

	paths := sc.strings(args[pathArg])
	if len(paths) == 0 {
		if clear {
			sc.skip(call, desc, "has a path that is not a literal, a constant or a concatenation of them")
		}
		return
	}
	prefixes := sc.prefixes(selector.X, 0)
	if prefixes.reason != "" {
		if clear {
			sc.skip(call, desc, prefixes.reason)
		}
		return
	}
	handler := args[handlerArg]
	if sc.subRouter(handler) {
		// A router handed to a router: its own routes are read where they
		// are registered.
		return
	}
	target, reason := sc.handler(handler, 0)
	if reason != "" {
		if clear {
			sc.skip(call, desc, "has a handler, "+types.ExprString(handler)+", that "+reason)
		}
		return
	}
	source, line := sc.p.position(call.Pos())
	for _, routePath := range paths {
		verb := method
		if pattern {
			verb = "ANY"
			if found, rest, ok := strings.Cut(routePath, " "); ok {
				verb, routePath = found, strings.TrimSpace(rest)
			}
		}
		for _, prefix := range prefixes.values {
			if !strings.HasPrefix(routePath, "/") && (routePath != "" || prefix == "") {
				if clear {
					sc.skip(call, desc, "has the path "+strconv.Quote(routePath)+", which does not start with /")
				}
				continue
			}
			full := joinRoutePath(prefix, routePath)
			sc.rr.endpoints = append(sc.rr.endpoints, serviceEndpoint{
				kind: "http", method: verb, path: full, label: verb + " " + full,
				entrypoint: functionEntry(target.dir, target.recv, target.fn.Name.Name), source: source, line: line,
				pkg: target.p, recvType: target.recv, fn: target.fn,
			})
		}
	}
}

func (sc *routeScope) subRouter(expr ast.Expr) bool {
	if call, ok := expr.(*ast.CallExpr); ok && len(call.Args) == 2 && sel(call) == "StripPrefix" {
		expr = call.Args[1]
	}
	kind := sc.router(expr)
	return kind != "" && types.ExprString(expr) != "http"
}

// handler is the function a registration hands a request to: a function or a
// method value, in this package or another of the module; a closure written
// in place; the closure or method value a factory returns; a value whose type
// has ServeHTTP. The reason says why none of those applies.
func (sc *routeScope) handler(expr ast.Expr, depth int) (routeTarget, string) {
	if depth > 3 {
		return routeTarget{}, "is built through more factories than this reader follows"
	}
	if call, ok := expr.(*ast.CallExpr); ok && len(call.Args) == 1 {
		if selector, ok := call.Fun.(*ast.SelectorExpr); ok && selector.Sel.Name == "HandlerFunc" {
			if alias, ok := selector.X.(*ast.Ident); ok && importsOf(sc.p)[alias.Name] == "net/http" {
				expr = call.Args[0]
			}
		}
	}
	if lit, ok := expr.(*ast.FuncLit); ok {
		return sc.closure(lit), ""
	}
	if typ, fn := registeredHTTPHandler(sc.p, sc.owner, expr); fn != nil {
		return routeTarget{p: sc.p, dir: sc.dir, recv: typ, fn: fn}, ""
	}
	fn := sc.function()
	if fn == nil {
		return routeTarget{}, "could not be followed to a declaration"
	}
	index := sc.rr.idx()
	switch value := expr.(type) {
	case *ast.Ident, *ast.SelectorExpr:
		targets := index.Targets(value, fn)
		if len(targets) == 1 {
			return sc.target(targets[0])
		}
		if len(targets) > 1 {
			return routeTarget{}, "may be any of " + strconv.Itoa(len(targets)) + " implementations"
		}
		if served := index.Functions[index.TypeOf(value, fn)+".ServeHTTP"]; served != nil {
			return sc.target(served)
		}
		if ident, ok := value.(*ast.Ident); ok {
			if given, ok := index.AssignedTo(fn, ident.Name); ok && given.Index == 0 {
				return sc.handler(given.Expr, depth+1)
			}
		}
		return routeTarget{}, "could not be followed to a declaration of this module"
	case *ast.CallExpr:
		callees := index.Callees(value, fn)
		if len(callees) > 1 {
			return routeTarget{}, "is built by one of " + strconv.Itoa(len(callees)) + " implementations"
		}
		if len(callees) == 0 || callees[0].Decl.Body == nil {
			return routeTarget{}, "is built by a function that is not declared in this module"
		}
		factory := callees[0]
		returns := topReturns(factory.Decl)
		if len(returns) != 1 || len(returns[0].Results) != 1 {
			return routeTarget{}, "is built by " + factory.Decl.Name.Name + ", which does not return one handler from one place"
		}
		next, reason := sc.at(factory)
		if reason != "" {
			return routeTarget{}, reason
		}
		return next.handler(returns[0].Results[0], depth+1)
	case *ast.CompositeLit, *ast.UnaryExpr:
		if served := index.Functions[index.TypeOf(value, fn)+".ServeHTTP"]; served != nil {
			return sc.target(served)
		}
	}
	return routeTarget{}, "is not a function, a method value, a closure or a factory this reader follows"
}

// at is a scope for reading inside another function of the module: a
// factory's body.
func (sc *routeScope) at(fn *goscan.Function) (*routeScope, string) {
	dir := path.Dir(fn.File.Name)
	p := sc.rr.pkg(dir)
	if p == nil {
		return nil, "is declared in a package this reader could not parse"
	}
	return &routeScope{rr: sc.rr, p: p, dir: dir, owner: fn.Decl, kinds: map[string]string{}, bound: map[string]routerPrefixes{}, base: []string{""}}, ""
}

func (sc *routeScope) target(fn *goscan.Function) (routeTarget, string) {
	dir := path.Dir(fn.File.Name)
	p := sc.rr.pkg(dir)
	if p == nil {
		return routeTarget{}, "is declared in a package this reader could not parse"
	}
	return routeTarget{p: p, dir: dir, recv: receiverTypeName(fn.Decl), fn: fn.Decl}, ""
}

// closure is a function literal read as a declaration of its own, named the
// way the Go toolchain names it (Routes.func1, Routes.func1.2). It keeps the
// enclosing receiver, and the enclosing parameters beside its own, since a
// closure reads what it captures.
func (sc *routeScope) closure(lit *ast.FuncLit) routeTarget {
	recv := receiverTypeName(sc.owner)
	if decl := sc.rr.closures[lit]; decl != nil {
		return routeTarget{p: sc.p, dir: sc.dir, recv: recv, fn: decl}
	}
	names := sc.rr.names[sc.owner]
	if names == nil {
		names = closureNames(sc.owner)
		sc.rr.names[sc.owner] = names
	}
	params := &ast.FieldList{Opening: lit.Type.Params.Opening, Closing: lit.Type.Params.Closing}
	own := map[string]bool{}
	for _, field := range lit.Type.Params.List {
		params.List = append(params.List, field)
		for _, name := range field.Names {
			own[name.Name] = true
		}
	}
	if sc.owner.Type.Params != nil {
		for _, field := range sc.owner.Type.Params.List {
			captured := &ast.Field{Type: field.Type}
			for _, name := range field.Names {
				if !own[name.Name] {
					captured.Names = append(captured.Names, name)
				}
			}
			if len(captured.Names) > 0 {
				params.List = append(params.List, captured)
			}
		}
	}
	decl := &ast.FuncDecl{
		Recv: sc.owner.Recv,
		Name: &ast.Ident{Name: names[lit], NamePos: lit.Pos()},
		Type: &ast.FuncType{Func: lit.Type.Func, Params: params, Results: lit.Type.Results},
		Body: lit.Body,
	}
	sc.rr.closures[lit] = decl
	return routeTarget{p: sc.p, dir: sc.dir, recv: recv, fn: decl}
}

func closureNames(fn *ast.FuncDecl) map[*ast.FuncLit]string {
	out := map[*ast.FuncLit]string{}
	var visit func(ast.Node, string, string)
	visit = func(node ast.Node, prefix, separator string) {
		count := 0
		ast.Inspect(node, func(n ast.Node) bool {
			lit, ok := n.(*ast.FuncLit)
			if !ok {
				return true
			}
			count++
			name := prefix + separator + strconv.Itoa(count)
			out[lit] = name
			visit(lit.Body, name, ".")
			return false
		})
	}
	if fn.Body != nil {
		visit(fn.Body, fn.Name.Name, ".func")
	}
	return out
}

// topReturns is a function's own return statements, not those of the
// closures it declares.
func topReturns(fn *ast.FuncDecl) []*ast.ReturnStmt {
	var out []*ast.ReturnStmt
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		switch value := node.(type) {
		case *ast.FuncLit:
			return false
		case *ast.ReturnStmt:
			out = append(out, value)
		}
		return true
	})
	return out
}

// mountedLocals is every router built in a function and mounted under a path
// in it: chi Mount(prefix, sub), and net/http Handle(prefix,
// http.StripPrefix(p, sub)).
func mountedLocals(fn *ast.FuncDecl) map[string]mountSite {
	out := map[string]mountSite{}
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) != 2 {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		switch selector.Sel.Name {
		case "Mount":
			if ident, ok := call.Args[1].(*ast.Ident); ok {
				out[ident.Name] = mountSite{router: selector.X, path: call.Args[0]}
			}
		case "Handle":
			if strip, ok := call.Args[1].(*ast.CallExpr); ok && sel(strip) == "StripPrefix" && len(strip.Args) == 2 {
				if ident, ok := strip.Args[1].(*ast.Ident); ok {
					out[ident.Name] = mountSite{router: selector.X, path: strip.Args[0]}
				}
			}
		}
		return true
	})
	return out
}

func (sc *routeScope) skip(call *ast.CallExpr, route, reason string) {
	if !sc.rr.emit || sc.generated {
		return
	}
	source, line := sc.p.position(call.Pos())
	sc.rr.skipped = append(sc.rr.skipped, routeSkip{ref: at(source, line), route: route, reason: reason})
}

func paramNames(fn *ast.FuncDecl) []string {
	var out []string
	if fn.Type.Params == nil {
		return out
	}
	for _, field := range fn.Type.Params.List {
		if len(field.Names) == 0 {
			out = append(out, "")
		}
		for _, name := range field.Names {
			out = append(out, name.Name)
		}
	}
	return out
}

// joinRoutePath puts a route under a prefix. An empty route is the prefix
// itself, the way a gin group registers its own root.
func joinRoutePath(prefix, route string) string {
	if route == "" {
		return prefix
	}
	return joinHTTPPath(prefix, route)
}

func dedupeSorted(values []string) []string {
	set := map[string]bool{}
	for _, value := range values {
		set[value] = true
	}
	return sortedKeys(set)
}
