package gohttp

import (
	"go/ast"
	"go/token"
	"strings"
	"unicode"
)

// URL templates. A request URL is assembled from literals the source spells
// and values only the running process knows. What source spells is kept; a
// value it does not is written as the expression that supplies it where it
// stands for a base URL, and as a `{name}` hole where it stands for a path
// segment, so `"book/" + strconv.FormatInt(orderID, 10)` reads as the route
// `book/{orderID}` rather than as a segment named after Go code.

// pathHole is the text for an operand nothing resolves, following the text
// before it: a hole when it opens a path segment, the expression otherwise.
func pathHole(before string, expr ast.Expr) string {
	if strings.HasSuffix(before, "/") {
		if name := holeName(expr); name != "" {
			return "{" + name + "}"
		}
	}
	return expression(expr)
}

// concatURL joins two pieces of a concatenation. A base URL that is joined
// with a relative path (`c.baseURL + "route-rules/"`) is one whose value ends
// with a slash, or the request would not reach a route at all; a constructor
// that normalizes the trailing slash is the common shape. The slash is written
// out so that the path keeps its first segment. Anything else is concatenated
// as it stands.
func concatURL(left, right string) string {
	if baseLike(left) && relativeSegment(right) {
		return left + "/" + right
	}
	return left + right
}

func baseLike(value string) bool {
	if value == "" || strings.ContainsAny(value[len(value)-1:], "/?&=#:.-_{%") {
		return false
	}
	if at := strings.Index(value, "://"); at >= 0 {
		rest := value[at+3:]
		return rest != "" && !strings.ContainsAny(rest, "?#")
	}
	if strings.ContainsAny(value, "/?") {
		return false
	}
	name := value
	if at := strings.LastIndex(name, "."); at >= 0 {
		name = name[at+1:]
	}
	name = strings.ToLower(name)
	for _, word := range []string{"url", "uri", "addr", "endpoint", "host", "base", "server"} {
		if strings.Contains(name, word) {
			return true
		}
	}
	return false
}

func relativeSegment(value string) bool {
	if value == "" {
		return false
	}
	first := []rune(value)[0]
	if !unicode.IsLetter(first) && !unicode.IsDigit(first) {
		return false
	}
	segment := value
	if at := strings.IndexAny(segment, "/?#"); at >= 0 {
		segment = segment[:at]
	}
	return !strings.ContainsAny(segment, ".:")
}

// urlJoin reports a path.Join, url.JoinPath or (*url.URL).JoinPath call.
func urlJoin(file *parsedFile, call *ast.CallExpr) bool {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || len(call.Args) == 0 {
		return false
	}
	owner, ok := selector.X.(*ast.Ident)
	if !ok {
		return false
	}
	switch file.imports[owner.Name] {
	case "path":
		return selector.Sel.Name == "Join"
	case "net/url":
		return selector.Sel.Name == "JoinPath"
	}
	return false
}

// joinedURL is the value of a URL join: every element after the first that
// does not resolve is a hole. The first is url.JoinPath's base URL, kept as
// its expression; path.Join's leading path nothing resolves is left out, as
// the URL it is joined into already carries it.
func (s *scanner) joinedURL(file *parsedFile, call *ast.CallExpr, locals map[string]string, seen map[string]bool) string {
	var parts []string
	resolved := false
	for index, argument := range call.Args {
		part := s.value(file, argument, locals, seen)
		if part != "" {
			resolved = true
		} else if index == 0 {
			if selectorName(call.Fun) == "JoinPath" {
				part = expression(argument)
			}
		} else if name := holeName(argument); name != "" {
			part = "{" + name + "}"
		}
		if part != "" {
			parts = append(parts, part)
		}
	}
	if !resolved {
		return ""
	}
	return joinURLParts(parts)
}

// formatURL fills a literal fmt.Sprintf format. A verb that opens the URL or
// follows its scheme is the base URL: its value when source gives one, else
// its expression. A verb anywhere else is a route or query parameter: a
// constant is written in, and so is a value bound from a caller that is a
// route itself (it holds a slash); anything else becomes a hole. A datum one
// caller passes (`raw/%s` with a settings key) is not the route.
func (s *scanner) formatURL(file *parsedFile, format string, args []ast.Expr, locals map[string]string, seen map[string]bool) string {
	var out strings.Builder
	next := 0
	for index := 0; index < len(format); index++ {
		if format[index] != '%' {
			out.WriteByte(format[index])
			continue
		}
		end := index + 1
		for end < len(format) && strings.IndexByte("+-# 0123456789.[]*", format[end]) >= 0 {
			end++
		}
		if end >= len(format) {
			out.WriteString(format[index:])
			break
		}
		if format[end] == '%' {
			out.WriteByte('%')
			index = end
			continue
		}
		if next >= len(args) {
			out.WriteString(format[index : end+1])
			index = end
			continue
		}
		argument := args[next]
		next++
		before := out.String()
		switch {
		case before == "" || strings.HasSuffix(before, "://"):
			if value := s.value(file, argument, locals, seen); value != "" {
				out.WriteString(value)
			} else {
				out.WriteString(expression(argument))
			}
		default:
			if value := s.value(file, argument, nil, map[string]bool{}); value != "" {
				out.WriteString(value)
			} else if value := s.value(file, argument, locals, seen); strings.Contains(value, "/") {
				// A bound value that is itself a route (`call(ctx, "api/v1/order/")`)
				// is the path this call site sends; a bare datum is not.
				out.WriteString(value)
			} else if name := holeName(argument); name != "" {
				out.WriteString("{" + name + "}")
			} else {
				out.WriteString(format[index : end+1])
			}
		}
		index = end
	}
	return out.String()
}

// callerSuppliedURL reports a raw call whose URL is only a string parameter of
// the function making it, with no route in source.
func (s *scanner) callerSuppliedURL(call Call) bool {
	declaration := s.functions[call.Function]
	if call.template == nil || declaration == nil || call.Path != "" || strings.ContainsAny(call.Endpoint, "/?") {
		return false
	}
	roots := map[string]string{}
	for name := range stringParams(declaration.fn) {
		roots[name] = ""
	}
	_, ok := carrier(call.template.endpoint, carriedNames(declaration.fn, roots))
	return ok && !s.possiblyCalled(call.Function)
}

// possiblyCalled reports a call somewhere in the tree that names the function
// with its arity but that the call graph could not link to any function: a
// method called on a parameter or a local of a type syntax does not know.
// Such a caller may hand the helper its route, so the helper's unbound call
// stays, unresolved, rather than vanish with the gap. A call the graph links
// elsewhere, or a package function of the same name (http.Post), is not one.
func (s *scanner) possiblyCalled(key string) bool {
	if known, ok := s.unlinked[key]; ok {
		return known
	}
	if s.unlinked == nil {
		s.unlinked = map[string]bool{}
	}
	declaration := s.functions[key]
	if declaration == nil {
		return false
	}
	name, arity := declaration.fn.Name.Name, len(functionParams(declaration.fn))
	method := declaration.fn.Recv != nil
	found := false
	for other, caller := range s.functions {
		if found {
			break
		}
		if other == key {
			continue
		}
		ast.Inspect(caller.fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if found || !ok || len(call.Args) != arity || selectorName(call.Fun) != name {
				return !found
			}
			if s.handsAFunction(caller, call) {
				// r.GET("/metrics", handler.Metrics): a router registering a
				// handler, not a helper handed a route.
				return true
			}
			if selector, isSelector := call.Fun.(*ast.SelectorExpr); isSelector {
				if owner, isIdent := selector.X.(*ast.Ident); isIdent && caller.file.imports[owner.Name] != "" && s.localTarget(caller, call.Fun) == "" {
					return true
				}
			} else if method {
				return true
			}
			if s.localTarget(caller, call.Fun) == "" {
				found = true
			}
			return !found
		})
	}
	s.unlinked[key] = found
	return found
}

// handsAFunction reports a call that passes a function value: a literal, a
// method or function of the tree named without calling it, or what a call
// into another package returns (gin.WrapH(...)).
func (s *scanner) handsAFunction(caller *functionDecl, call *ast.CallExpr) bool {
	for _, argument := range call.Args {
		switch x := argument.(type) {
		case *ast.FuncLit:
			return true
		case *ast.SelectorExpr:
			if len(s.methods[x.Sel.Name]) > 0 {
				return true
			}
		case *ast.Ident:
			key := x.Name
			if caller.file.dir != "." && caller.file.dir != "" {
				key = caller.file.dir + ":" + key
			}
			if s.functions[key] != nil {
				return true
			}
		case *ast.CallExpr:
			if selector, ok := x.Fun.(*ast.SelectorExpr); ok {
				if owner, ok := selector.X.(*ast.Ident); ok && caller.file.imports[owner.Name] != "" && s.localTarget(caller, x.Fun) == "" {
					return true
				}
			}
		}
	}
	return false
}

// stringParams are a function's parameters declared as string: the shape a
// URL a caller hands in has.
func stringParams(fn *ast.FuncDecl) map[string]bool {
	out := map[string]bool{}
	if fn.Type.Params == nil {
		return out
	}
	for _, field := range fn.Type.Params.List {
		if typ, ok := field.Type.(*ast.Ident); !ok || typ.Name != "string" {
			continue
		}
		for _, name := range field.Names {
			out[name.Name] = true
		}
	}
	return out
}

// carriedNames extends params (a parameter to the caller that wrote its
// value) with the locals that hold one of those values as a string is passed
// on: assigned it, concatenated with it or formatted from it. A field read
// from it or a call made with it is another value.
func carriedNames(fn *ast.FuncDecl, params map[string]string) map[string]string {
	carried := map[string]string{}
	for name, writer := range params {
		carried[name] = writer
	}
	if len(carried) == 0 || fn.Body == nil {
		return carried
	}
	for changed := true; changed; {
		changed = false
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			assign, ok := localAssignment(node)
			if !ok {
				return true
			}
			for index, left := range assign.Lhs {
				name := expression(left)
				if _, seen := carried[name]; seen {
					continue
				}
				at := index
				if len(assign.Rhs) == 1 {
					at = 0
				}
				if at >= len(assign.Rhs) {
					continue
				}
				if writer, ok := carrier(assign.Rhs[at], carried); ok {
					carried[name] = writer
					changed = true
				}
			}
			return true
		})
	}
	return carried
}

// carrier reports whether expr passes on a carried value, and whose: the
// last one in it, as a path follows the base it is joined to.
func carrier(expr ast.Expr, names map[string]string) (string, bool) {
	if len(names) == 0 {
		return "", false
	}
	switch x := expr.(type) {
	case *ast.Ident:
		writer, ok := names[x.Name]
		return writer, ok
	case *ast.ParenExpr:
		return carrier(x.X, names)
	case *ast.BinaryExpr:
		if x.Op != token.ADD {
			return "", false
		}
		if writer, ok := carrier(x.Y, names); ok {
			return writer, true
		}
		return carrier(x.X, names)
	case *ast.CallExpr:
		switch selectorName(x.Fun) {
		case "Sprintf", "Join", "JoinPath":
			for index := len(x.Args) - 1; index >= 0; index-- {
				if writer, ok := carrier(x.Args[index], names); ok {
					return writer, true
				}
			}
		}
	}
	return "", false
}

// holeName names the value an expression supplies: the variable or field it
// reads, looking through the conversions and escapes wrapped around it
// (`url.QueryEscape(strconv.FormatInt(orderID, 10))` is orderID).
func holeName(expr ast.Expr) string {
	switch x := expr.(type) {
	case *ast.Ident:
		switch x.Name {
		case "nil", "true", "false", "_":
			return ""
		}
		return x.Name
	case *ast.SelectorExpr:
		return x.Sel.Name
	case *ast.CallExpr:
		for _, argument := range x.Args {
			if name := holeName(argument); name != "" {
				return name
			}
		}
		if selector, ok := x.Fun.(*ast.SelectorExpr); ok && len(x.Args) == 0 {
			return holeName(selector.X)
		}
	case *ast.IndexExpr:
		return holeName(x.X)
	case *ast.ParenExpr:
		return holeName(x.X)
	case *ast.StarExpr:
		return holeName(x.X)
	case *ast.UnaryExpr:
		return holeName(x.X)
	}
	return ""
}
