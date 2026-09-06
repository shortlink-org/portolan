package main

import (
	"go/ast"
	"go/token"
	"strconv"

	"github.com/shortlink-org/portolan/internal/goscan"
)

// hops is how far up the callers a subject is followed. One hop is the port:
// the adapter takes the subject as a parameter and the assembly passes a
// constant. Two is an assembly that itself was handed the subject. Further
// than that is not a declaration any more.
const hops = 2

// resolved is one string an expression was found to be, where it was
// written, and - when it came through a wrapper that also names the message -
// what the message is called.
type resolved struct {
	value string
	at    goscan.Source
	name  string
}

// resolve is the strings an expression can be worth: a literal; a constant,
// the tree's own or an imported one; a config field's default; a call to a
// function whose body is one return; a parameter, by what every caller
// passes for it.
func (s *scanner) resolve(expr ast.Expr, fn *function, depth int, visiting map[string]bool) []resolved {
	at := s.At(expr.Pos())
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, _ := strconv.Unquote(value.Value)
			return []resolved{{value: text, at: at}}
		}
	case *ast.Ident:
		if index := paramIndex(fn, value.Name); index >= 0 {
			return s.fromCallers(fn, index, depth, visiting)
		}
		key := fn.key + ":" + value.Name
		if visiting[key] {
			return nil
		}
		visiting[key] = true
		defer delete(visiting, key)
		if given, ok := s.assignedTo(fn, value.Name); ok {
			if given.index == 0 {
				return s.resolve(given.expr, fn, depth, visiting)
			}
			return nil
		}
		if text := s.StringOf(value, fn.file, nil); text != "" {
			return []resolved{{value: text, at: at}}
		}
	case *ast.SelectorExpr:
		if text := s.StringOf(value, fn.file, nil); text != "" {
			return []resolved{{value: text, at: at}}
		}
		if st := s.structs[s.typeOf(value.X, fn)]; st != nil {
			if def := st.defaults[value.Sel.Name]; def != "" {
				return []resolved{{value: def, at: at}}
			}
		}
	case *ast.CallExpr:
		var out []resolved
		for _, target := range s.callees(value, fn) {
			if ret := singleReturn(target); ret != nil {
				key := "call:" + target.key
				if visiting[key] {
					continue
				}
				visiting[key] = true
				out = append(out, s.resolve(ret, target, depth, visiting)...)
				delete(visiting, key)
			}
		}
		return out
	}
	return nil
}

// fromCallers is what a parameter is worth: whatever each call site passes
// for it, resolved there. A call site that also passes a literal or constant
// for the one other string parameter of the same function is taken to name
// the message - the shape of a bus port, Subscribe(subject, name, handler).
func (s *scanner) fromCallers(fn *function, index, depth int, visiting map[string]bool) []resolved {
	if depth >= hops {
		return nil
	}
	key := fn.key + "#" + strconv.Itoa(index)
	if visiting[key] {
		return nil
	}
	visiting[key] = true
	defer delete(visiting, key)

	nameIndex := s.companionString(fn, index)
	var out []resolved
	for _, caller := range s.sortedFunctions() {
		ast.Inspect(caller.decl.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || index >= len(call.Args) || !s.reaches(call, caller, fn) {
				return true
			}
			found := s.resolve(call.Args[index], caller, depth+1, visiting)
			if nameIndex >= 0 && nameIndex < len(call.Args) {
				names := s.resolve(call.Args[nameIndex], caller, depth+1, visiting)
				if len(names) == 1 {
					for i := range found {
						found[i].name = names[0].value
					}
				}
			}
			out = append(out, found...)
			return true
		})
	}
	return out
}

// reaches is whether a call lands on fn: directly, or through an interface
// fn's receiver satisfies.
func (s *scanner) reaches(call *ast.CallExpr, caller, fn *function) bool {
	for _, target := range s.callees(call, caller) {
		if target == fn {
			return true
		}
	}
	return false
}

// companionString is the one string parameter beside the subject, or -1
// when there is none or more than one.
func (s *scanner) companionString(fn *function, subject int) int {
	found := -1
	for i, param := range fn.params {
		if i == subject || fn.types[param] != "string" {
			continue
		}
		if found >= 0 {
			return -1
		}
		found = i
	}
	return found
}

// singleReturn is the expression a function is, when its whole body is
// `return x`: the Name() of an event, the Topic() of a message.
func singleReturn(fn *function) ast.Expr {
	if fn.decl.Body == nil || len(fn.decl.Body.List) != 1 {
		return nil
	}
	ret, ok := fn.decl.Body.List[0].(*ast.ReturnStmt)
	if !ok || len(ret.Results) != 1 {
		return nil
	}
	return ret.Results[0]
}
