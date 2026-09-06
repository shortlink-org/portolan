package gohttp

import (
	"go/ast"
	"go/token"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Endpoint flows join the two independently provable halves of a request:
// route -> handler -> interface operation, and factory branch -> concrete
// implementation -> outbound call. The join is deliberately conservative;
// a route without all of that evidence remains represented by the ordinary
// outbound flows instead of acquiring guessed branches.
func (s *scanner) endpointFlows(groups []FlowGroup) []EndpointFlow {
	groupByFunction := map[string]FlowGroup{}
	for _, group := range groups {
		groupByFunction[group.Function] = group
	}

	var out []EndpointFlow
	seen := map[string]bool{}
	for _, owner := range s.functions {
		ast.Inspect(owner.fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			method, path, handler, ok := s.routeCall(owner, call)
			if !ok {
				return true
			}
			var handlerKey, operation string
			var factory *functionDecl
			for _, candidate := range s.routeHandlers(owner, handler) {
				candidateOperation, candidateFactory := s.endpointOperation(candidate)
				if candidateOperation != "" && candidateFactory != nil {
					handlerKey, operation, factory = candidate, candidateOperation, candidateFactory
					break
				}
			}
			if operation == "" || factory == nil {
				return true
			}
			branches := s.endpointBranches(factory, operation, groupByFunction)
			if len(branches) == 0 {
				return true
			}
			key := method + "\x00" + path + "\x00" + handlerKey
			if seen[key] {
				return true
			}
			seen[key] = true
			out = append(out, EndpointFlow{
				Method: method, Path: path, Handler: handlerKey,
				Source: s.source(owner.file, call.Pos()), Branches: branches,
			})
			return true
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Path != out[j].Path {
			return out[i].Path < out[j].Path
		}
		return out[i].Method < out[j].Method
	})
	return out
}

var routeMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true,
	"DELETE": true, "HEAD": true, "OPTIONS": true,
}

func (s *scanner) routeCall(owner *functionDecl, call *ast.CallExpr) (string, string, ast.Expr, bool) {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || len(call.Args) < 2 {
		return "", "", nil, false
	}
	name := selector.Sel.Name
	method := strings.ToUpper(name)
	pathIndex := 0
	if name == "Method" || name == "MethodFunc" {
		if len(call.Args) < 3 {
			return "", "", nil, false
		}
		method = httpMethod(call.Args[0])
		pathIndex = 1
	} else if name == "Handle" || name == "HandleFunc" {
		method = "HTTP"
	} else if !routeMethods[method] {
		return "", "", nil, false
	}
	if receiver, ok := selector.X.(*ast.Ident); ok && owner.file.imports[receiver.Name] == "net/http" && name != "Handle" && name != "HandleFunc" {
		return "", "", nil, false
	}
	literal, ok := call.Args[pathIndex].(*ast.BasicLit)
	if !ok || literal.Kind != token.STRING {
		return "", "", nil, false
	}
	path, err := strconv.Unquote(literal.Value)
	if err != nil || !strings.HasPrefix(path, "/") {
		return "", "", nil, false
	}
	return method, path, call.Args[len(call.Args)-1], true
}

func (s *scanner) routeHandlers(owner *functionDecl, expr ast.Expr) []string {
	if literal, ok := expr.(*ast.FuncLit); ok {
		var targets []string
		ast.Inspect(literal.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			if target := s.localTarget(owner, call.Fun); target != "" {
				targets = append(targets, target)
			} else if target := s.localVariableMethod(owner, call.Fun); target != "" {
				targets = append(targets, target)
			}
			return true
		})
		return uniqueStrings(targets)
	}
	if call, ok := expr.(*ast.CallExpr); ok {
		if target := s.localTarget(owner, call.Fun); target != "" {
			return []string{target}
		}
	}
	if target := s.localTarget(owner, expr); target != "" {
		return []string{target}
	}
	if target := s.localVariableMethod(owner, expr); target != "" {
		return []string{target}
	}
	return nil
}

type endpointType struct {
	dir  string
	name string
}

func (s *scanner) localVariableMethod(owner *functionDecl, expr ast.Expr) string {
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	identifier, ok := selector.X.(*ast.Ident)
	if !ok {
		return ""
	}
	types := s.localConcreteTypes(owner)
	typ, ok := types[identifier.Name]
	if !ok {
		return ""
	}
	return s.methodKey(typ, selector.Sel.Name)
}

func (s *scanner) localTypes(owner *functionDecl) map[string]endpointType {
	out := map[string]endpointType{}
	ast.Inspect(owner.fn.Body, func(node ast.Node) bool {
		switch statement := node.(type) {
		case *ast.AssignStmt:
			for index, left := range statement.Lhs {
				name, ok := left.(*ast.Ident)
				if !ok || index >= len(statement.Rhs) {
					continue
				}
				if typ, ok := s.expressionType(owner.file, statement.Rhs[index]); ok {
					out[name.Name] = typ
				}
			}
		case *ast.DeclStmt:
			declaration, ok := statement.Decl.(*ast.GenDecl)
			if !ok {
				return true
			}
			for _, raw := range declaration.Specs {
				spec, ok := raw.(*ast.ValueSpec)
				if !ok || spec.Type == nil {
					continue
				}
				typ, ok := s.typeExpression(owner.file, spec.Type)
				if !ok {
					continue
				}
				for _, name := range spec.Names {
					out[name.Name] = typ
				}
			}
		}
		return true
	})
	return out
}

func (s *scanner) expressionType(file *parsedFile, expr ast.Expr) (endpointType, bool) {
	if literal := compositeLiteral(expr); literal != nil {
		return s.typeExpression(file, literal.Type)
	}
	return endpointType{}, false
}

func (s *scanner) typeExpression(file *parsedFile, expr ast.Expr) (endpointType, bool) {
	switch value := expr.(type) {
	case *ast.StarExpr:
		return s.typeExpression(file, value.X)
	case *ast.Ident:
		return endpointType{dir: file.dir, name: value.Name}, true
	case *ast.SelectorExpr:
		alias, ok := value.X.(*ast.Ident)
		if !ok {
			return endpointType{}, false
		}
		if dir := s.importDirectory(file, alias.Name); dir != "" {
			return endpointType{dir: dir, name: value.Sel.Name}, true
		}
	}
	return endpointType{}, false
}

func (s *scanner) importDirectory(file *parsedFile, alias string) string {
	path := file.imports[alias]
	best := ""
	for _, candidate := range s.files {
		dir := candidate.dir
		if path == dir || strings.HasSuffix(path, "/"+dir) {
			if len(dir) > len(best) {
				best = dir
			}
		}
	}
	return best
}

func (s *scanner) methodKey(typ endpointType, method string) string {
	key := typ.name + "." + method
	if typ.dir != "." && typ.dir != "" {
		key = typ.dir + ":" + key
	}
	if s.functions[key] != nil {
		return key
	}
	return ""
}

func (s *scanner) endpointOperation(handlerKey string) (string, *functionDecl) {
	handler := s.functions[handlerKey]
	if handler == nil {
		return "", nil
	}
	localTypes := s.localTypes(handler)
	var operation string
	var coordinator *functionDecl
	ast.Inspect(handler.fn.Body, func(node ast.Node) bool {
		if operation != "" {
			return false
		}
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		targetKey := s.localTarget(handler, call.Fun)
		target := s.functions[targetKey]
		if target == nil {
			return true
		}
		params := functionParams(target.fn)
		for index, argument := range call.Args {
			if index >= len(params) {
				continue
			}
			typ, ok := s.endpointArgumentType(handler, argument, localTypes)
			if !ok {
				continue
			}
			for _, method := range methodsCalledOn(target.fn, params[index]) {
				concrete := s.functions[s.methodKey(typ, method)]
				if concrete == nil {
					continue
				}
				factory := s.factoryCalledBy(target)
				if factory == nil {
					continue
				}
				for _, candidate := range interfaceOperations(concrete.fn) {
					if s.factorySupportsOperation(factory, candidate) {
						operation, coordinator = candidate, factory
						return false
					}
				}
			}
		}
		return true
	})
	if operation == "" {
		operation, coordinator = s.directEndpointOperation(handler)
	}
	if operation == "" && len(s.typedEdges) > 0 {
		return s.typedEndpointOperation(handlerKey)
	}
	return operation, coordinator
}

// typedEndpointOperation handles coordinators that pass a concrete request
// through more than one interface-typed helper before invoking a provider.
// VTA supplies possible callees; the existing factory analysis keeps the
// provider set and its source conditions precise and explainable.
func (s *scanner) typedEndpointOperation(handlerKey string) (string, *functionDecl) {
	type visit struct {
		key   string
		depth int
	}
	queue := []visit{{key: handlerKey}}
	seen := map[string]bool{}
	depths := map[string]int{}
	var factories []*functionDecl
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current.depth > 10 || seen[current.key] {
			continue
		}
		seen[current.key] = true
		depths[current.key] = current.depth
		declaration := s.functions[current.key]
		if declaration != nil {
			if factory := s.factoryCalledBy(declaration); factory != nil {
				factories = append(factories, factory)
			}
		}
		for _, edge := range s.typedEdges[current.key] {
			queue = append(queue, visit{key: edge.target, depth: current.depth + 1})
		}
	}

	type candidate struct {
		operation string
		factory   *functionDecl
		depth     int
	}
	var candidates []candidate
	for _, factory := range uniqueFunctions(factories) {
		for key, depth := range depths {
			operation := methodName(key)
			if operation != "" && s.factorySupportsOperation(factory, operation) {
				candidates = append(candidates, candidate{operation: operation, factory: factory, depth: depth})
			}
		}
	}
	if len(candidates) == 0 {
		return "", nil
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].depth != candidates[j].depth {
			return candidates[i].depth < candidates[j].depth
		}
		if candidates[i].operation != candidates[j].operation {
			return candidates[i].operation < candidates[j].operation
		}
		return candidates[i].factory.key < candidates[j].factory.key
	})
	best := candidates[0]
	for _, candidate := range candidates[1:] {
		if candidate.depth != best.depth {
			break
		}
		if candidate.operation != best.operation || candidate.factory.key != best.factory.key {
			// VTA is deliberately context-insensitive. If several operations are
			// equally close through a shared dispatcher, refusing the join is
			// safer than attaching every provider call to the wrong endpoint.
			return "", nil
		}
	}
	return best.operation, best.factory
}

func methodName(key string) string {
	display := displayFunction(key)
	if at := strings.LastIndex(display, "."); at >= 0 {
		return display[at+1:]
	}
	return ""
}

func uniqueFunctions(in []*functionDecl) []*functionDecl {
	seen := map[string]bool{}
	var out []*functionDecl
	for _, function := range in {
		if function != nil && !seen[function.key] {
			out = append(out, function)
			seen[function.key] = true
		}
	}
	return out
}

func (s *scanner) hasRouteAndProviderFactory() bool {
	hasFactory := false
	for _, declaration := range s.functions {
		if len(s.factoryCases(declaration)) > 0 {
			hasFactory = true
			break
		}
	}
	if !hasFactory {
		return false
	}
	for _, owner := range s.functions {
		found := false
		ast.Inspect(owner.fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if ok {
				_, _, _, found = s.routeCall(owner, call)
			}
			return !found
		})
		if found {
			return true
		}
	}
	return false
}

func (s *scanner) endpointArgumentType(owner *functionDecl, expr ast.Expr, locals map[string]endpointType) (endpointType, bool) {
	switch value := expr.(type) {
	case *ast.Ident:
		typ, ok := locals[value.Name]
		return typ, ok
	case *ast.ParenExpr:
		return s.endpointArgumentType(owner, value.X, locals)
	case *ast.UnaryExpr:
		return s.endpointArgumentType(owner, value.X, locals)
	case *ast.CompositeLit:
		return s.typeExpression(owner.file, value.Type)
	}
	return endpointType{}, false
}

func (s *scanner) directEndpointOperation(handler *functionDecl) (string, *functionDecl) {
	factory := s.factoryCalledBy(handler)
	if factory == nil {
		return "", nil
	}
	factoryResult := map[string]bool{}
	ast.Inspect(handler.fn.Body, func(node ast.Node) bool {
		assignment, ok := node.(*ast.AssignStmt)
		if !ok || len(assignment.Rhs) == 0 {
			return true
		}
		if call, ok := assignment.Rhs[0].(*ast.CallExpr); ok && s.isFactoryCall(handler, call, factory) {
			if name, ok := assignment.Lhs[0].(*ast.Ident); ok {
				factoryResult[name.Name] = true
			}
		}
		propagateAliases(assignment, factoryResult)
		return true
	})
	var operation string
	ast.Inspect(handler.fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if expressionUsesAlias(selector.X, factoryResult) {
			operation = selector.Sel.Name
			return false
		}
		return true
	})
	if operation == "" {
		return "", nil
	}
	return operation, factory
}

func (s *scanner) isFactoryCall(owner *functionDecl, call *ast.CallExpr, factory *functionDecl) bool {
	if s.localTarget(owner, call.Fun) == factory.key {
		return true
	}
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	factoryName := displayFunction(factory.key)
	if at := strings.LastIndex(factoryName, "."); at >= 0 {
		factoryName = factoryName[at+1:]
	}
	return selector.Sel.Name == factoryName
}

func methodsCalledOn(fn *ast.FuncDecl, variable string) []string {
	var methods []string
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		root, ok := selector.X.(*ast.Ident)
		if ok && root.Name == variable {
			methods = append(methods, selector.Sel.Name)
		}
		return true
	})
	return uniqueStrings(methods)
}

func interfaceOperations(fn *ast.FuncDecl) []string {
	aliases := map[string]bool{}
	if fn.Type.Params != nil {
		for _, field := range fn.Type.Params.List {
			for _, name := range field.Names {
				aliases[name.Name] = true
			}
		}
	}
	var operations []string
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		if assignment, ok := node.(*ast.AssignStmt); ok {
			propagateAliases(assignment, aliases)
			return true
		}
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if expressionUsesAlias(selector.X, aliases) && selector.Sel.Name != "Error" {
			operations = append(operations, selector.Sel.Name)
		}
		return true
	})
	return uniqueStrings(operations)
}

// propagateAliases follows the value-preserving assembly shapes used for
// capability narrowing: alias := value and capability, ok := value.(Port).
// It does not follow arbitrary calls or selectors, which could change identity.
func propagateAliases(assignment *ast.AssignStmt, aliases map[string]bool) {
	for index, left := range assignment.Lhs {
		name, ok := left.(*ast.Ident)
		if !ok {
			continue
		}
		rightAt := index
		if len(assignment.Rhs) == 1 {
			if index > 0 {
				continue
			}
			rightAt = 0
		}
		if rightAt >= len(assignment.Rhs) || !expressionUsesAlias(assignment.Rhs[rightAt], aliases) {
			continue
		}
		aliases[name.Name] = true
	}
}

func expressionUsesAlias(expr ast.Expr, aliases map[string]bool) bool {
	switch value := expr.(type) {
	case *ast.Ident:
		return aliases[value.Name]
	case *ast.ParenExpr:
		return expressionUsesAlias(value.X, aliases)
	case *ast.UnaryExpr:
		return expressionUsesAlias(value.X, aliases)
	case *ast.TypeAssertExpr:
		return expressionUsesAlias(value.X, aliases)
	}
	return false
}

func (s *scanner) factorySupportsOperation(factory *functionDecl, operation string) bool {
	for _, branch := range s.factoryCases(factory) {
		if s.providerOperation(branch.provider, operation, map[string]bool{}) != "" {
			return true
		}
	}
	return false
}

func (s *scanner) factoryCalledBy(coordinator *functionDecl) *functionDecl {
	var candidates []string
	ast.Inspect(coordinator.fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		if target := s.localTarget(coordinator, call.Fun); target != "" {
			candidates = append(candidates, target)
		}
		if selector, ok := call.Fun.(*ast.SelectorExpr); ok {
			candidates = append(candidates, s.methods[selector.Sel.Name]...)
		}
		return true
	})
	for _, key := range uniqueStrings(candidates) {
		declaration := s.functions[key]
		if declaration != nil && len(s.factoryCases(declaration)) > 0 {
			return declaration
		}
	}
	return nil
}

type factoryCase struct {
	condition string
	provider  string
}

func (s *scanner) factoryCases(factory *functionDecl) []factoryCase {
	var out []factoryCase
	ast.Inspect(factory.fn.Body, func(node ast.Node) bool {
		clause, ok := node.(*ast.CaseClause)
		if !ok || len(clause.List) == 0 {
			return true
		}
		provider := s.providerOfCase(factory.file, clause)
		if provider == "" {
			return true
		}
		for _, expression := range clause.List {
			condition := s.value(factory.file, expression, map[string]string{}, map[string]bool{})
			if condition != "" {
				out = append(out, factoryCase{condition: condition, provider: provider})
			}
		}
		return true
	})
	if len(out) > 0 {
		return out
	}
	if mapped := s.factoryMapCases(factory); len(mapped) > 0 {
		return mapped
	}
	providers := s.returnedProviders(factory)
	if len(providers) != 1 {
		return nil
	}
	return []factoryCase{{condition: filepath.Base(providers[0]), provider: providers[0]}}
}

func (s *scanner) factoryMapCases(factory *functionDecl) []factoryCase {
	used := map[string]bool{}
	ast.Inspect(factory.fn.Body, func(node ast.Node) bool {
		ret, ok := node.(*ast.ReturnStmt)
		if !ok {
			return true
		}
		for _, result := range ret.Results {
			if name := indexedMapName(result); name != "" {
				used[name] = true
			}
		}
		return true
	})
	if len(used) == 0 {
		return nil
	}

	literals := map[string]*ast.CompositeLit{}
	record := func(name string, expr ast.Expr) {
		literal := compositeLiteral(expr)
		if literal == nil {
			return
		}
		if _, ok := literal.Type.(*ast.MapType); ok && used[name] {
			literals[name] = literal
		}
	}
	ast.Inspect(factory.fn.Body, func(node ast.Node) bool {
		switch value := node.(type) {
		case *ast.AssignStmt:
			for index, left := range value.Lhs {
				name, ok := left.(*ast.Ident)
				if ok && index < len(value.Rhs) {
					record(name.Name, value.Rhs[index])
				}
			}
		case *ast.ValueSpec:
			for index, name := range value.Names {
				if index < len(value.Values) {
					record(name.Name, value.Values[index])
				}
			}
		}
		return true
	})
	for _, declaration := range factory.file.node.Decls {
		generic, ok := declaration.(*ast.GenDecl)
		if !ok || generic.Tok != token.VAR {
			continue
		}
		for _, raw := range generic.Specs {
			spec, ok := raw.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for index, name := range spec.Names {
				if index < len(spec.Values) {
					record(name.Name, spec.Values[index])
				}
			}
		}
	}

	var out []factoryCase
	seen := map[string]bool{}
	for _, literal := range literals {
		for _, element := range literal.Elts {
			pair, ok := element.(*ast.KeyValueExpr)
			if !ok {
				continue
			}
			condition := s.value(factory.file, pair.Key, map[string]string{}, map[string]bool{})
			provider := s.providerExpression(factory.file, pair.Value, map[string]string{})
			key := condition + "\x00" + provider
			if condition == "" || provider == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, factoryCase{condition: condition, provider: provider})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].condition < out[j].condition })
	return out
}

func indexedMapName(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.ParenExpr:
		return indexedMapName(value.X)
	case *ast.UnaryExpr:
		return indexedMapName(value.X)
	case *ast.CallExpr:
		return indexedMapName(value.Fun)
	case *ast.IndexExpr:
		if name, ok := value.X.(*ast.Ident); ok {
			return name.Name
		}
	}
	return ""
}

// returnedProviders recognizes a fixed factory without manufacturing branches:
// a single local provider is returned, possibly through a temporary variable.
// Two distinct returns are ambiguous unless a switch supplied their conditions,
// so this conservative fallback rejects them.
func (s *scanner) returnedProviders(factory *functionDecl) []string {
	locals := map[string]string{}
	var providers []string
	ast.Inspect(factory.fn.Body, func(node ast.Node) bool {
		switch value := node.(type) {
		case *ast.AssignStmt:
			for index, left := range value.Lhs {
				name, ok := left.(*ast.Ident)
				if !ok {
					continue
				}
				rightAt := index
				if len(value.Rhs) == 1 {
					rightAt = 0
				}
				if rightAt >= len(value.Rhs) {
					continue
				}
				if provider := s.providerExpression(factory.file, value.Rhs[rightAt], locals); provider != "" {
					locals[name.Name] = provider
				}
			}
		case *ast.ReturnStmt:
			for _, result := range value.Results {
				if provider := s.providerExpression(factory.file, result, locals); provider != "" {
					providers = append(providers, provider)
				}
			}
		}
		return true
	})
	return uniqueStrings(providers)
}

func (s *scanner) providerOfCase(file *parsedFile, clause *ast.CaseClause) string {
	locals := map[string]string{}
	for _, statement := range clause.Body {
		ast.Inspect(statement, func(node ast.Node) bool {
			assignment, ok := node.(*ast.AssignStmt)
			if !ok {
				return true
			}
			for index, left := range assignment.Lhs {
				name, ok := left.(*ast.Ident)
				if !ok || index >= len(assignment.Rhs) {
					continue
				}
				if provider := s.providerExpression(file, assignment.Rhs[index], locals); provider != "" {
					locals[name.Name] = provider
				}
			}
			return true
		})
	}
	var provider string
	for _, statement := range clause.Body {
		ast.Inspect(statement, func(node ast.Node) bool {
			if provider != "" {
				return false
			}
			ret, ok := node.(*ast.ReturnStmt)
			if !ok {
				return true
			}
			for _, result := range ret.Results {
				if candidate := s.providerExpression(file, result, locals); candidate != "" {
					provider = candidate
					return false
				}
			}
			return true
		})
		if provider != "" {
			return provider
		}
	}
	return ""
}

func (s *scanner) providerExpression(file *parsedFile, expr ast.Expr, locals map[string]string) string {
	switch value := expr.(type) {
	case *ast.Ident:
		return locals[value.Name]
	case *ast.UnaryExpr:
		return s.providerExpression(file, value.X, locals)
	case *ast.CompositeLit:
		if selector, ok := value.Type.(*ast.SelectorExpr); ok {
			if alias, ok := selector.X.(*ast.Ident); ok {
				return s.importDirectory(file, alias.Name)
			}
		}
	case *ast.CallExpr:
		if selector, ok := value.Fun.(*ast.SelectorExpr); ok {
			if alias, ok := selector.X.(*ast.Ident); ok {
				return s.importDirectory(file, alias.Name)
			}
		}
	case *ast.SelectorExpr:
		if alias, ok := value.X.(*ast.Ident); ok {
			return s.importDirectory(file, alias.Name)
		}
	case *ast.FuncLit:
		var providers []string
		ast.Inspect(value.Body, func(node ast.Node) bool {
			ret, ok := node.(*ast.ReturnStmt)
			if !ok {
				return true
			}
			for _, result := range ret.Results {
				if provider := s.providerExpression(file, result, locals); provider != "" {
					providers = append(providers, provider)
				}
			}
			return true
		})
		providers = uniqueStrings(providers)
		if len(providers) == 1 {
			return providers[0]
		}
	}
	return ""
}

func (s *scanner) endpointBranches(factory *functionDecl, operation string, groups map[string]FlowGroup) []EndpointBranch {
	var out []EndpointBranch
	seen := map[string]bool{}
	for _, branch := range s.factoryCases(factory) {
		function := s.providerOperation(branch.provider, operation, map[string]bool{})
		if function == "" {
			continue
		}
		group := s.typedOutboundGroup(function, groups)
		if len(group.Calls) == 0 {
			if descendant, ok := providerOutboundGroup(branch.provider, operation, groups); ok {
				group = descendant
				function = descendant.Function
			}
		}
		key := branch.condition + "\x00" + function
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, EndpointBranch{
			Condition: branch.condition, Provider: branch.provider,
			Operation: operation, Function: function, Calls: group.Calls,
			Source: s.source(s.functions[function].file, s.functions[function].fn.Pos()),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Condition < out[j].Condition })
	return out
}

// typedOutboundGroup follows dynamic calls only after a concrete provider
// branch has been chosen. Keeping VTA out of the shared coordinator graph is
// important: VTA is context-insensitive, so a common ActionFlow may otherwise
// appear to call every Requester implementation from every endpoint.
func (s *scanner) typedOutboundGroup(root string, groups map[string]FlowGroup) FlowGroup {
	base := groups[root]
	if base.Function == "" {
		base.Function = root
		if declaration := s.functions[root]; declaration != nil {
			base.Source = s.source(declaration.file, declaration.fn.Pos())
		}
	}
	if len(s.typedEdges) == 0 {
		return base
	}

	type visit struct {
		key   string
		path  []string
		depth int
	}
	queue := []visit{{key: root}}
	seenDepth := map[string]int{}
	calls := append([]Call(nil), base.Calls...)
	for len(queue) > 0 && len(seenDepth) < 256 {
		current := queue[0]
		queue = queue[1:]
		if current.depth > 8 {
			continue
		}
		if depth, seen := seenDepth[current.key]; seen && depth <= current.depth {
			continue
		}
		seenDepth[current.key] = current.depth
		path := appendCopy(current.path, displayFunction(current.key))
		if current.key != root {
			if descendant, ok := groups[current.key]; ok {
				for _, call := range descendant.Calls {
					copy := call
					copy.Chain = joinCallChains(path, call.Chain)
					calls = append(calls, copy)
				}
			}
		}
		for _, edge := range s.typedEdges[current.key] {
			queue = append(queue, visit{key: edge.target, path: path, depth: current.depth + 1})
		}
	}
	base.Calls = uniqueFlowCalls(calls)
	return base
}

func joinCallChains(prefix, suffix []string) []string {
	out := append([]string(nil), prefix...)
	for _, item := range suffix {
		if len(out) == 0 || out[len(out)-1] != item {
			out = append(out, item)
		}
	}
	return out
}

func providerOutboundGroup(provider, operation string, groups map[string]FlowGroup) (FlowGroup, bool) {
	var candidates []FlowGroup
	for key, group := range groups {
		dir, display, qualified := strings.Cut(key, ":")
		if !qualified || (dir != provider && !strings.HasPrefix(dir, provider+"/")) {
			continue
		}
		if strings.HasSuffix(display, "."+operation) || display == operation {
			candidates = append(candidates, group)
		}
	}
	if len(candidates) == 0 {
		return FlowGroup{}, false
	}
	sort.Slice(candidates, func(i, j int) bool {
		leftDir, _, _ := strings.Cut(candidates[i].Function, ":")
		rightDir, _, _ := strings.Cut(candidates[j].Function, ":")
		if len(leftDir) != len(rightDir) {
			return len(leftDir) < len(rightDir)
		}
		return candidates[i].Function < candidates[j].Function
	})
	return candidates[0], true
}

func (s *scanner) providerOperation(provider, operation string, visiting map[string]bool) string {
	visitKey := provider + ":" + operation
	if visiting[visitKey] {
		return ""
	}
	visiting[visitKey] = true
	defer delete(visiting, visitKey)

	var candidates []string
	for key := range s.functions {
		dir, display, qualified := strings.Cut(key, ":")
		if !qualified || dir != provider {
			continue
		}
		if strings.HasSuffix(display, "."+operation) || display == operation {
			candidates = append(candidates, key)
		}
	}
	if len(candidates) > 0 {
		sort.Strings(candidates)
		return candidates[0]
	}

	// Go promotes methods from embedded fields. Following those fields lets a
	// factory branch such as aeroflot.New(*websky.Connector) inherit Search
	// without pretending that aeroflot declares its own implementation.
	for _, file := range s.files {
		if file.dir != provider {
			continue
		}
		for _, declaration := range file.node.Decls {
			generic, ok := declaration.(*ast.GenDecl)
			if !ok || generic.Tok != token.TYPE {
				continue
			}
			for _, raw := range generic.Specs {
				spec, ok := raw.(*ast.TypeSpec)
				if !ok {
					continue
				}
				structure, ok := spec.Type.(*ast.StructType)
				if !ok {
					continue
				}
				for _, field := range structure.Fields.List {
					if len(field.Names) != 0 {
						continue
					}
					typ, ok := s.typeExpression(file, field.Type)
					if !ok {
						continue
					}
					if key := s.methodKey(typ, operation); key != "" {
						return key
					}
					if key := s.providerOperation(typ.dir, operation, visiting); key != "" {
						return key
					}
				}
			}
		}
	}
	return ""
}
