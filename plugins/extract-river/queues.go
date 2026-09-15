package extractriver

import (
	"go/ast"
	"go/token"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/internal/goscan"
)

// stringFuncs are the standard library's pure rewrites of one string that a
// queue name is commonly passed through on its way from config: the value
// that comes out is known whenever the value that goes in is.
var stringFuncs = map[string]func(string) string{
	"strings.ToLower":   strings.ToLower,
	"strings.ToUpper":   strings.ToUpper,
	"strings.TrimSpace": strings.TrimSpace,
}

// fieldSite is one place a struct field is given a value: a composite
// literal of the struct, keyed or positional, or an assignment to the field.
type fieldSite struct {
	expr ast.Expr
	fn   *goscan.Function
}

// queueValues is every string a queue expression can be worth. It reads what
// goscan's Resolve reads - a literal, a constant of the tree or River's own, a
// config field's default, a parameter by what its callers pass - and the
// paths a queue name takes in a service that keeps it beside the client
// rather than writing it at the insert:
//
//   - a struct field with no default, by what the struct is built with where
//     it is built: `&Runner{client, queue}` in a constructor, or `r.queue = q`;
//   - a local assigned more than once, by every value it is given, where a
//     fallback under `if name == ""` counts only when the value before it can
//     be empty;
//   - a call into the tree, by what every return of the callee is worth, and
//     not only a callee whose whole body is one return;
//   - `strings.ToLower` and its kin over any of those.
//
// Nil when any part of the way is only known at run time: a partial answer is
// not given as a whole one.
func (s *scanner) queueValues(expr ast.Expr, fn *goscan.Function, depth int, visiting map[string]bool) []string {
	if expr == nil {
		return nil
	}
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, _ := strconv.Unquote(value.Value)
			return []string{text}
		}
	case *ast.Ident:
		if index := goscan.ParamIndex(fn, value.Name); index >= 0 {
			return s.queuesFromCallers(fn, index, depth, visiting)
		}
		if found, local := s.localQueues(value.Name, fn, depth, visiting); local {
			return found
		}
		if text := s.StringOf(value, fn.File, nil); text != "" {
			return []string{text}
		}
	case *ast.SelectorExpr:
		if text := s.StringOf(value, fn.File, nil); text != "" {
			return []string{text}
		}
		owner := s.TypeOf(value.X, fn)
		if st := s.Structs[owner]; st != nil {
			if def := st.Defaults[value.Sel.Name]; def != "" {
				return []string{def}
			}
			return s.fieldQueues(owner, value.Sel.Name, depth, visiting)
		}
	case *ast.BinaryExpr:
		if value.Op != token.ADD {
			return nil
		}
		left := s.queueValues(value.X, fn, depth, visiting)
		right := s.queueValues(value.Y, fn, depth, visiting)
		var out []string
		for _, a := range left {
			for _, b := range right {
				out = appendUnique(out, a+b)
			}
		}
		return out
	case *ast.CallExpr:
		return s.callQueues(value, fn, depth, visiting)
	}
	return nil
}

// callQueues is what a call yields as a queue name: a `string(x)` conversion,
// a standard rewrite of a known string, or a function of the tree by its
// returns.
func (s *scanner) callQueues(call *ast.CallExpr, fn *goscan.Function, depth int, visiting map[string]bool) []string {
	if ident, ok := call.Fun.(*ast.Ident); ok && ident.Name == "string" && len(call.Args) == 1 && s.Functions[fn.File.Pkg+".string"] == nil {
		return s.queueValues(call.Args[0], fn, depth, visiting)
	}
	if rewrite := stringFuncs[s.ExternalKey(call, fn)]; rewrite != nil && len(call.Args) == 1 {
		var out []string
		for _, text := range s.queueValues(call.Args[0], fn, depth, visiting) {
			out = appendUnique(out, rewrite(text))
		}
		return out
	}
	var out []string
	for _, target := range s.Callees(call, fn) {
		key := "call:" + target.Key
		if visiting[key] || target.Decl.Body == nil {
			continue
		}
		visiting[key] = true
		found := s.returnQueues(target, depth, visiting)
		delete(visiting, key)
		if found == nil {
			return nil
		}
		for _, text := range found {
			out = appendUnique(out, text)
		}
	}
	return out
}

// returnQueues is every string a function returns, when each of its returns
// of one value resolves. A return inside a function literal is that literal's,
// not this function's.
func (s *scanner) returnQueues(target *goscan.Function, depth int, visiting map[string]bool) []string {
	var out []string
	resolved := true
	seen := false
	ast.Inspect(target.Decl.Body, func(node ast.Node) bool {
		if _, literal := node.(*ast.FuncLit); literal {
			return false
		}
		ret, ok := node.(*ast.ReturnStmt)
		if !ok {
			return true
		}
		seen = true
		if len(ret.Results) != 1 {
			resolved = false
			return false
		}
		found := s.queueValues(ret.Results[0], target, depth, visiting)
		if len(found) == 0 {
			resolved = false
		}
		for _, text := range found {
			out = appendUnique(out, text)
		}
		return false
	})
	if !seen || !resolved {
		return nil
	}
	return out
}

// queuesFromCallers is what a parameter is worth: whatever each call site
// passes for it, resolved there, followed Hops levels up.
func (s *scanner) queuesFromCallers(fn *goscan.Function, index, depth int, visiting map[string]bool) []string {
	if depth >= s.Hops {
		return nil
	}
	key := fn.Key + "#" + strconv.Itoa(index)
	if visiting[key] {
		return nil
	}
	visiting[key] = true
	defer delete(visiting, key)
	var out []string
	for _, arg := range s.ArgsFromCallers(fn, index) {
		for _, text := range s.queueValues(arg.Expr, arg.Fn, depth+1, visiting) {
			out = appendUnique(out, text)
		}
	}
	return out
}

// localQueues is what a local name can be worth, and whether the name is a
// local at all. Every assignment counts, not only the last: a queue chosen as
// `q := strings.ToLower(branch)` and then `if q == "" { q = river.QueueDefault }`
// is the branch whenever the branch is known not to be empty, and the
// fallback is the value only when it can be. One assignment that does not
// resolve leaves the whole name unresolved.
func (s *scanner) localQueues(name string, fn *goscan.Function, depth int, visiting map[string]bool) ([]string, bool) {
	if fn.Decl.Body == nil {
		return nil, false
	}
	key := fn.Key + ":" + name
	if visiting[key] {
		return nil, true
	}
	visiting[key] = true
	defer delete(visiting, key)

	type given struct {
		expr     ast.Expr
		guarded  bool
		unusable bool
	}
	var values []given
	var walk func(node ast.Node, guarded bool)
	record := func(lhs, rhs []ast.Expr, tok token.Token, guarded bool) {
		for i, target := range lhs {
			ident, ok := target.(*ast.Ident)
			if !ok || ident.Name != name {
				continue
			}
			switch {
			case tok != token.ASSIGN && tok != token.DEFINE:
				values = append(values, given{unusable: true})
			case len(rhs) == len(lhs):
				values = append(values, given{expr: rhs[i], guarded: guarded})
			default:
				values = append(values, given{unusable: true})
			}
		}
	}
	walk = func(root ast.Node, guarded bool) {
		ast.Inspect(root, func(node ast.Node) bool {
			switch stmt := node.(type) {
			case *ast.IfStmt:
				if stmt.Init != nil {
					walk(stmt.Init, guarded)
				}
				walk(stmt.Body, guarded || emptyCheck(stmt.Cond, name))
				if stmt.Else != nil {
					walk(stmt.Else, guarded)
				}
				return false
			case *ast.AssignStmt:
				record(stmt.Lhs, stmt.Rhs, stmt.Tok, guarded)
			case *ast.ValueSpec:
				if len(stmt.Values) == 0 {
					return true
				}
				lhs := make([]ast.Expr, 0, len(stmt.Names))
				for _, ident := range stmt.Names {
					lhs = append(lhs, ident)
				}
				record(lhs, stmt.Values, token.DEFINE, guarded)
			}
			return true
		})
	}
	walk(fn.Decl.Body, false)
	if len(values) == 0 {
		return nil, false
	}

	var plain, fallback []string
	canBeEmpty := false
	for _, value := range values {
		if value.unusable {
			return nil, true
		}
		found := s.queueValues(value.expr, fn, depth, visiting)
		if len(found) == 0 {
			return nil, true
		}
		for _, text := range found {
			switch {
			case value.guarded:
				fallback = appendUnique(fallback, text)
			case text == "":
				canBeEmpty = true
			default:
				plain = appendUnique(plain, text)
			}
		}
	}
	if canBeEmpty || len(plain) == 0 {
		for _, text := range fallback {
			plain = appendUnique(plain, text)
		}
	}
	return plain, true
}

// emptyCheck is whether a condition holds only when name is the empty
// string: `name == ""`, `"" == name` or `len(name) == 0`.
func emptyCheck(cond ast.Expr, name string) bool {
	binary, ok := goscan.Unwrap(cond).(*ast.BinaryExpr)
	if !ok || binary.Op != token.EQL {
		return false
	}
	isName := func(expr ast.Expr) bool {
		ident, ok := goscan.Unwrap(expr).(*ast.Ident)
		return ok && ident.Name == name
	}
	isEmpty := func(expr ast.Expr) bool {
		lit, ok := goscan.Unwrap(expr).(*ast.BasicLit)
		return ok && lit.Kind == token.STRING && (lit.Value == `""` || lit.Value == "``")
	}
	isLen := func(expr ast.Expr) bool {
		call, ok := goscan.Unwrap(expr).(*ast.CallExpr)
		if !ok || len(call.Args) != 1 {
			return false
		}
		fun, ok := call.Fun.(*ast.Ident)
		return ok && fun.Name == "len" && isName(call.Args[0])
	}
	isZero := func(expr ast.Expr) bool {
		lit, ok := goscan.Unwrap(expr).(*ast.BasicLit)
		return ok && lit.Kind == token.INT && lit.Value == "0"
	}
	return (isName(binary.X) && isEmpty(binary.Y)) || (isEmpty(binary.X) && isName(binary.Y)) ||
		(isLen(binary.X) && isZero(binary.Y)) || (isZero(binary.X) && isLen(binary.Y))
}

// fieldQueues is what a struct field with no default is worth: what every
// place that builds the struct or assigns the field gives it. A field nothing
// in the tree sets is not resolved.
func (s *scanner) fieldQueues(owner, field string, depth int, visiting map[string]bool) []string {
	key := "field:" + owner + "." + field
	if visiting[key] {
		return nil
	}
	visiting[key] = true
	defer delete(visiting, key)
	var out []string
	for _, site := range s.fieldSites(owner, field) {
		for _, text := range s.queueValues(site.expr, site.fn, depth, visiting) {
			out = appendUnique(out, text)
		}
	}
	return out
}

// fieldSites is every expression the tree gives a struct's field, read once
// per field: `T{field: x}`, `T{a, x}` by the field's position, and
// `v.field = x` on a value of the type.
func (s *scanner) fieldSites(owner, field string) []fieldSite {
	key := owner + "." + field
	if found, ok := s.sites[key]; ok {
		return found
	}
	position := -1
	for i, name := range s.fieldOrder[owner] {
		if name == field {
			position = i
		}
	}
	var out []fieldSite
	for _, fn := range s.SortedFunctions() {
		ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
			switch value := node.(type) {
			case *ast.CompositeLit:
				if value.Type == nil || s.TypeKey(value.Type, fn.File) != owner {
					return true
				}
				for i, raw := range value.Elts {
					if pair, keyed := raw.(*ast.KeyValueExpr); keyed {
						if name, ok := pair.Key.(*ast.Ident); ok && name.Name == field {
							out = append(out, fieldSite{expr: pair.Value, fn: fn})
						}
					} else if i == position {
						out = append(out, fieldSite{expr: raw, fn: fn})
					}
				}
			case *ast.AssignStmt:
				if len(value.Lhs) != len(value.Rhs) {
					return true
				}
				for i, target := range value.Lhs {
					sel, ok := target.(*ast.SelectorExpr)
					if ok && sel.Sel.Name == field && s.TypeOf(sel.X, fn) == owner {
						out = append(out, fieldSite{expr: value.Rhs[i], fn: fn})
					}
				}
			}
			return true
		})
	}
	s.sites[key] = out
	return out
}

// structOrder is a struct's field names in declaration order, an embedded
// field under the name the language gives it: what a positional literal is
// read against.
func structOrder(body *ast.StructType) []string {
	var out []string
	for _, field := range body.Fields.List {
		if len(field.Names) == 0 {
			out = append(out, goscan.EmbeddedName(field.Type))
			continue
		}
		for _, name := range field.Names {
			out = append(out, name.Name)
		}
	}
	return out
}
