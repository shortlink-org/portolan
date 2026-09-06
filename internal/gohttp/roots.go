package gohttp

import (
	"go/ast"
	"sort"
	"strings"
)

// rootFlows discovers execution roots that do not need the provider-factory
// join used by endpointFlows. Every root still needs an outbound FlowGroup;
// registering a handler alone is not enough to manufacture a flow.
func (s *scanner) rootFlows(groups []FlowGroup, providerEndpoints []EndpointFlow) []RootFlow {
	byFunction := map[string]FlowGroup{}
	for _, group := range groups {
		byFunction[group.Function] = group
	}
	providerRoutes := map[string]bool{}
	for _, endpoint := range providerEndpoints {
		providerRoutes[routeKey(endpoint.Method, endpoint.Path)] = true
	}

	var out []RootFlow
	rootedHandlers := map[string]bool{}
	rootedRoutes := map[string]bool{}
	registrations := s.handlerRegistrations()
	for _, owner := range s.sortedFunctions() {
		ast.Inspect(owner.fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			method, path, handler, ok := s.routeCall(owner, call)
			if !ok || providerRoutes[routeKey(method, path)] || rootedRoutes[routeKey(method, path)] {
				return true
			}
			root := RootFlow{
				Kind: RootHTTP, Method: method, Path: path,
				Label: strings.TrimSpace(method + " " + path), Confidence: "high",
				Source: s.source(owner.file, call.Pos()),
			}
			for _, candidate := range s.routeHandlers(owner, handler) {
				group, found := byFunction[candidate]
				if !found || len(group.Calls) == 0 {
					continue
				}
				if root.Handler == "" {
					root.Handler = candidate
				}
				root.Calls = append(root.Calls, group.Calls...)
				root.Covered = append(root.Covered, candidate)
				rootedHandlers[candidate] = true
			}
			root.Calls = uniqueFlowCalls(root.Calls)
			root.Covered = uniqueStrings(root.Covered)
			if len(root.Calls) == 0 {
				return true
			}
			rootedRoutes[routeKey(method, path)] = true
			out = append(out, root)
			return true
		})
	}

	for _, owner := range s.sortedFunctions() {
		ast.Inspect(owner.fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			schedule, handler, ok := s.scheduledRegistration(owner, call)
			if !ok {
				return true
			}
			for _, candidate := range s.routeHandlers(owner, handler) {
				group, found := byFunction[candidate]
				if !found || len(group.Calls) == 0 {
					continue
				}
				label := "Schedule " + schedule + " → " + displayFunction(candidate)
				out = append(out, RootFlow{
					Kind: RootScheduled, Handler: candidate, Label: label, Confidence: "high",
					Source: s.source(owner.file, call.Pos()), Calls: group.Calls,
					Covered: []string{candidate},
				})
				rootedHandlers[candidate] = true
			}
			return true
		})
	}

	// Swagger-style route annotations are useful for handler factories and
	// custom registries whose final path is assembled by framework code. They
	// are medium-confidence evidence: a concrete registration above wins when
	// both point to the same source function.
	for _, declaration := range s.sortedFunctions() {
		if rootedHandlers[declaration.key] {
			continue
		}
		group, found := byFunction[declaration.key]
		if !found || len(group.Calls) == 0 {
			continue
		}
		method, path, ok := annotatedRoute(declaration.fn)
		if !ok || providerRoutes[routeKey(method, path)] || rootedRoutes[routeKey(method, path)] {
			continue
		}
		kind := RootHTTP
		if looksLikeCallback(path, declaration.key) {
			kind = RootCallback
		}
		confidence := "medium"
		source := group.Source
		if registeredAt, registered := registrations[declaration.key]; registered {
			confidence = "high"
			source = registeredAt
		}
		out = append(out, RootFlow{
			Kind: kind, Method: method, Path: path, Handler: declaration.key,
			Label: strings.TrimSpace(method + " " + path), Confidence: confidence,
			Source: source, Calls: group.Calls, Covered: []string{declaration.key},
		})
		rootedHandlers[declaration.key] = true
		rootedRoutes[routeKey(method, path)] = true
	}

	// main and package-main init are lifecycle roots. Calls inside registered
	// closures are deliberately skipped: those execute when their own HTTP or
	// async root fires, not while the process is starting.
	for _, owner := range s.sortedFunctions() {
		if !lifecycleFunction(owner) {
			continue
		}
		out = append(out, s.lifecycleRoots(owner, byFunction, map[string]bool{}, 0)...)
	}

	out = uniqueRootFlows(out)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		if out[i].Label != out[j].Label {
			return out[i].Label < out[j].Label
		}
		return out[i].Handler < out[j].Handler
	})
	return out
}

// handlerRegistrations upgrades a route annotation from documentation-only
// evidence when source also passes that handler to a conventional registry.
// The annotation still supplies the path; the registration proves it is live.
func (s *scanner) handlerRegistrations() map[string]Source {
	out := map[string]Source{}
	for _, owner := range s.sortedFunctions() {
		ast.Inspect(owner.fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || (selector.Sel.Name != "Register" && selector.Sel.Name != "Handle") {
				return true
			}
			for _, argument := range call.Args {
				target := s.handlerExpressionTarget(owner, argument)
				if target != "" {
					out[target] = s.source(owner.file, call.Pos())
				}
			}
			return true
		})
	}
	return out
}

func (s *scanner) handlerExpressionTarget(owner *functionDecl, expr ast.Expr) string {
	if call, ok := expr.(*ast.CallExpr); ok {
		return s.localTarget(owner, call.Fun)
	}
	if target := s.localTarget(owner, expr); target != "" {
		return target
	}
	return s.localVariableMethod(owner, expr)
}

func (s *scanner) scheduledRegistration(owner *functionDecl, call *ast.CallExpr) (string, ast.Expr, bool) {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || len(call.Args) < 2 {
		return "", nil, false
	}
	switch selector.Sel.Name {
	case "AddFunc", "AfterFunc", "Schedule":
	default:
		return "", nil, false
	}
	locals := s.localStrings(owner.file, owner.fn)
	schedule := s.value(owner.file, call.Args[0], locals, map[string]bool{})
	if schedule == "" {
		schedule = expression(call.Args[0])
	}
	if schedule == "" {
		schedule = "registered"
	}
	return schedule, call.Args[len(call.Args)-1], true
}

func (s *scanner) lifecycleRoots(owner *functionDecl, groups map[string]FlowGroup, visiting map[string]bool, depth int) []RootFlow {
	if owner == nil || depth > 4 || visiting[owner.key] {
		return nil
	}
	visiting[owner.key] = true
	defer delete(visiting, owner.key)
	var out []RootFlow
	ast.Inspect(owner.fn.Body, func(node ast.Node) bool {
		if _, nested := node.(*ast.FuncLit); nested {
			return false
		}
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		target := s.localTarget(owner, call.Fun)
		if target == "" {
			target = s.localVariableMethod(owner, call.Fun)
		}
		if group, found := groups[target]; found && len(group.Calls) > 0 {
			out = append(out, RootFlow{
				Kind: RootStartup, Handler: target,
				Label: "Startup → " + displayFunction(target), Confidence: "high",
				Source: s.source(owner.file, call.Pos()), Calls: group.Calls,
				Covered: []string{target},
			})
			return true
		}
		if next := s.functions[target]; assemblyEntrypoint(next) {
			out = append(out, s.lifecycleRoots(next, groups, visiting, depth+1)...)
		}
		return true
	})
	return out
}

func (s *scanner) sortedFunctions() []*functionDecl {
	keys := make([]string, 0, len(s.functions))
	for key := range s.functions {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]*functionDecl, 0, len(keys))
	for _, key := range keys {
		out = append(out, s.functions[key])
	}
	return out
}

func annotatedRoute(fn *ast.FuncDecl) (string, string, bool) {
	if fn.Doc == nil {
		return "", "", false
	}
	for _, line := range strings.Split(fn.Doc.Text(), "\n") {
		at := strings.Index(line, "@Router")
		if at < 0 {
			continue
		}
		fields := strings.Fields(line[at+len("@Router"):])
		if len(fields) < 2 || !strings.HasPrefix(fields[0], "/") {
			continue
		}
		method := strings.ToUpper(strings.Trim(fields[1], "[]"))
		if method == "" {
			method = "HTTP"
		}
		return method, fields[0], true
	}
	return "", "", false
}

func lifecycleFunction(declaration *functionDecl) bool {
	name := displayFunction(declaration.key)
	return declaration.file.pkg == "main" && (name == "init" || name == "main")
}

func assemblyEntrypoint(declaration *functionDecl) bool {
	if declaration == nil {
		return false
	}
	name := displayFunction(declaration.key)
	if at := strings.LastIndex(name, "."); at >= 0 {
		return false
	}
	switch name {
	case "Run", "Start", "Bootstrap":
		dir := "/" + strings.Trim(declaration.file.dir, "/") + "/"
		return strings.Contains(dir, "/app/") || strings.Contains(dir, "/cmd/")
	}
	return false
}

func looksLikeCallback(path, function string) bool {
	value := strings.ToLower(path + " " + function)
	return strings.Contains(value, "callback") || strings.Contains(value, "webhook")
}

func routeKey(method, path string) string {
	return strings.ToUpper(method) + "\x00" + path
}

func uniqueRootFlows(in []RootFlow) []RootFlow {
	seen := map[string]bool{}
	out := make([]RootFlow, 0, len(in))
	for _, root := range in {
		key := string(root.Kind) + "\x00" + root.Label + "\x00" + root.Handler
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, root)
	}
	return out
}
