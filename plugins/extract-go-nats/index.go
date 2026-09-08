package extractgonats

import (
	"go/ast"
	"go/token"
	"reflect"
	"sort"
	"strconv"

	"github.com/shortlink-org/portolan/internal/goscan"
)

const (
	natsPkg = "github.com/nats-io/nats.go"
	jsPkg   = "github.com/nats-io/nats.go/jetstream"
)

// structType is a struct as the reader needs it: what type each field has, so
// that `b.conn` is known to be a connection, and what a field defaults to
// when its tag says, so that a subject read off config resolves.
type structType struct {
	key      string
	fields   map[string]string
	defaults map[string]string
}

// function is one declared function or method: its parameters by name and
// type, what it returns, and what its body assigns to which name.
type function struct {
	key      string
	name     string
	receiver string
	file     *goscan.File
	decl     *ast.FuncDecl
	params   []string
	types    map[string]string
	results  []string
	assigned map[string]assignment
}

// assignment is the last thing a local name was given: the expression, and
// which of its values when the expression yields several.
type assignment struct {
	expr  ast.Expr
	index int
}

// scanner is the tree, and the shapes in it a nats call is read against.
type scanner struct {
	*goscan.Tree
	structs    map[string]*structType
	interfaces map[string][]string
	functions  map[string]*function
	methods    map[string][]*function
	byName     map[string][]*function
	// typing is the locals whose type is being worked out right now, so a
	// name shadowed by an expression of itself - `js := js.Sub()` in an
	// inner block - ends rather than recurses.
	typing map[string]bool
}

func newScanner(tree *goscan.Tree) *scanner {
	return &scanner{
		Tree:       tree,
		structs:    map[string]*structType{},
		interfaces: map[string][]string{},
		functions:  map[string]*function{},
		methods:    map[string][]*function{},
		byName:     map[string][]*function{},
		typing:     map[string]bool{},
	}
}

func (s *scanner) index() {
	for _, file := range s.Files {
		for _, decl := range file.Node.Decls {
			switch d := decl.(type) {
			case *ast.GenDecl:
				if d.Tok != token.TYPE {
					continue
				}
				for _, raw := range d.Specs {
					s.indexType(file, raw.(*ast.TypeSpec))
				}
			case *ast.FuncDecl:
				s.indexFunction(file, d)
			}
		}
	}
}

func (s *scanner) indexType(file *goscan.File, spec *ast.TypeSpec) {
	key := file.Pkg + "." + spec.Name.Name
	switch body := spec.Type.(type) {
	case *ast.StructType:
		st := &structType{key: key, fields: map[string]string{}, defaults: map[string]string{}}
		for _, field := range body.Fields.List {
			typeKey := s.TypeKey(field.Type, file)
			def := ""
			if field.Tag != nil {
				tag, _ := strconv.Unquote(field.Tag.Value)
				def = reflect.StructTag(tag).Get("default")
			}
			for _, name := range field.Names {
				st.fields[name.Name] = typeKey
				if def != "" {
					st.defaults[name.Name] = def
				}
			}
		}
		s.structs[key] = st
	case *ast.InterfaceType:
		// Embedded interfaces are not followed: the port a service writes for
		// its bus names its methods itself.
		var names []string
		for _, method := range body.Methods.List {
			for _, name := range method.Names {
				names = append(names, name.Name)
			}
		}
		sort.Strings(names)
		s.interfaces[key] = names
	}
}

func (s *scanner) indexFunction(file *goscan.File, decl *ast.FuncDecl) {
	key := file.Pkg + "." + decl.Name.Name
	receiver := ""
	if decl.Recv != nil && len(decl.Recv.List) > 0 {
		receiver = s.TypeKey(decl.Recv.List[0].Type, file)
		key = receiver + "." + decl.Name.Name
	}
	fn := &function{key: key, name: decl.Name.Name, receiver: receiver, file: file, decl: decl, types: map[string]string{}}
	if decl.Recv != nil {
		for _, field := range decl.Recv.List {
			for _, name := range field.Names {
				fn.types[name.Name] = receiver
			}
		}
	}
	if decl.Type.Params != nil {
		for _, field := range decl.Type.Params.List {
			typeKey := s.TypeKey(field.Type, file)
			for _, name := range field.Names {
				fn.params = append(fn.params, name.Name)
				fn.types[name.Name] = typeKey
			}
		}
	}
	if decl.Type.Results != nil {
		for _, field := range decl.Type.Results.List {
			typeKey := s.TypeKey(field.Type, file)
			if len(field.Names) == 0 {
				fn.results = append(fn.results, typeKey)
			}
			for range field.Names {
				fn.results = append(fn.results, typeKey)
			}
		}
	}
	s.functions[key] = fn
	if receiver != "" {
		s.methods[receiver] = append(s.methods[receiver], fn)
		s.byName[fn.name] = append(s.byName[fn.name], fn)
	}
}

// implements is whether a receiver type has every method an interface asks
// for, by name. Names are what a port is: a type with the right names is
// what the assembly hands over, and the compiler holds the signatures.
func (s *scanner) implements(receiver, iface string) bool {
	want := s.interfaces[iface]
	if len(want) == 0 {
		return false
	}
	have := map[string]bool{}
	for _, fn := range s.methods[receiver] {
		have[fn.name] = true
	}
	for _, name := range want {
		if !have[name] {
			return false
		}
	}
	return true
}

// assignedTo is the last expression a local name was given in the function,
// read once per function.
func (s *scanner) assignedTo(fn *function, name string) (assignment, bool) {
	if fn.assigned == nil {
		fn.assigned = map[string]assignment{}
		if fn.decl.Body != nil {
			ast.Inspect(fn.decl.Body, func(node ast.Node) bool {
				switch stmt := node.(type) {
				case *ast.AssignStmt:
					record(fn.assigned, stmt.Lhs, stmt.Rhs)
				case *ast.ValueSpec:
					var lhs []ast.Expr
					for _, ident := range stmt.Names {
						lhs = append(lhs, ident)
					}
					record(fn.assigned, lhs, stmt.Values)
				}
				return true
			})
		}
	}
	found, ok := fn.assigned[name]
	return found, ok
}

func record(into map[string]assignment, lhs, rhs []ast.Expr) {
	if len(rhs) == 0 {
		return
	}
	for i, target := range lhs {
		ident, ok := target.(*ast.Ident)
		if !ok || ident.Name == "_" {
			continue
		}
		if len(rhs) == 1 && len(lhs) > 1 {
			into[ident.Name] = assignment{expr: rhs[0], index: i}
		} else if i < len(rhs) {
			into[ident.Name] = assignment{expr: rhs[i]}
		}
	}
}

// typeOf is the type key of an expression, as far as declarations say: a
// parameter or receiver by its declared type, a local by what it was
// assigned, a field by its struct, a call by what the callee returns.
func (s *scanner) typeOf(expr ast.Expr, fn *function) string {
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.Ident:
		if kind := fn.types[value.Name]; kind != "" {
			return kind
		}
		key := fn.key + ":" + value.Name
		if s.typing[key] {
			return ""
		}
		s.typing[key] = true
		defer delete(s.typing, key)
		if given, ok := s.assignedTo(fn, value.Name); ok {
			if call, isCall := goscan.Unwrap(given.expr).(*ast.CallExpr); isCall {
				results := s.resultsOf(call, fn)
				if given.index < len(results) {
					return results[given.index]
				}
				return ""
			}
			if given.index == 0 {
				return s.typeOf(given.expr, fn)
			}
		}
	case *ast.CompositeLit:
		return s.TypeKey(value.Type, fn.file)
	case *ast.SelectorExpr:
		if st := s.structs[s.typeOf(value.X, fn)]; st != nil {
			return st.fields[value.Sel.Name]
		}
	case *ast.CallExpr:
		if results := s.resultsOf(value, fn); len(results) > 0 {
			return results[0]
		}
	}
	return ""
}

// knownResults is what the nats.go constructors hand back, since their
// declarations are not in the tree.
var knownResults = map[string][]string{
	natsPkg + ".Connect":                      {natsPkg + ".Conn", "error"},
	natsPkg + ".Conn.JetStream":               {natsPkg + ".JetStreamContext", "error"},
	jsPkg + ".New":                            {jsPkg + ".JetStream", "error"},
	jsPkg + ".NewWithAPIPrefix":               {jsPkg + ".JetStream", "error"},
	jsPkg + ".NewWithDomain":                  {jsPkg + ".JetStream", "error"},
	jsPkg + ".JetStream.Stream":               {jsPkg + ".Stream", "error"},
	jsPkg + ".JetStream.CreateStream":         {jsPkg + ".Stream", "error"},
	jsPkg + ".JetStream.UpdateStream":         {jsPkg + ".Stream", "error"},
	jsPkg + ".JetStream.CreateOrUpdateStream": {jsPkg + ".Stream", "error"},
}

// resultsOf is what a call returns: the callee's declared results when it is
// in the tree, the table above when it is nats.go's.
func (s *scanner) resultsOf(call *ast.CallExpr, fn *function) []string {
	for _, target := range s.callees(call, fn) {
		return target.results
	}
	if key := s.externalKey(call, fn); key != "" {
		return knownResults[key]
	}
	return nil
}

// externalKey names a call on something declared outside the tree: a
// package function by import path, a method by the type of what it is
// called on.
func (s *scanner) externalKey(call *ast.CallExpr, fn *function) string {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	if base, ok := sel.X.(*ast.Ident); ok {
		if imported := fn.file.Imports[base.Name]; imported != "" && fn.types[base.Name] == "" {
			if _, local := s.assignedTo(fn, base.Name); !local {
				return imported + "." + sel.Sel.Name
			}
		}
	}
	if recv := s.typeOf(sel.X, fn); recv != "" {
		return recv + "." + sel.Sel.Name
	}
	return ""
}

// callees is every function in the tree a call may reach: the one named,
// when it is a plain function or a method on a known type; every
// implementation, when it is a method on an interface the tree declares.
func (s *scanner) callees(call *ast.CallExpr, fn *function) []*function {
	switch callee := call.Fun.(type) {
	case *ast.Ident:
		if target := s.functions[fn.file.Pkg+"."+callee.Name]; target != nil {
			return []*function{target}
		}
	case *ast.SelectorExpr:
		if base, ok := callee.X.(*ast.Ident); ok && fn.types[base.Name] == "" {
			if imported := fn.file.Imports[base.Name]; imported != "" {
				if _, local := s.assignedTo(fn, base.Name); !local {
					if target := s.functions[imported+"."+callee.Sel.Name]; target != nil {
						return []*function{target}
					}
					return nil
				}
			}
		}
		recv := s.typeOf(callee.X, fn)
		if recv == "" {
			return nil
		}
		if target := s.functions[recv+"."+callee.Sel.Name]; target != nil {
			return []*function{target}
		}
		if s.interfaces[recv] != nil {
			var out []*function
			for _, candidate := range s.byName[callee.Sel.Name] {
				if s.implements(candidate.receiver, recv) {
					out = append(out, candidate)
				}
			}
			sort.Slice(out, func(i, j int) bool { return out[i].key < out[j].key })
			return out
		}
	}
	return nil
}

// paramIndex is which parameter a name is, or -1.
func paramIndex(fn *function, name string) int {
	for i, param := range fn.params {
		if param == name {
			return i
		}
	}
	return -1
}

// sortedFunctions is every function with a body, in a fixed order.
func (s *scanner) sortedFunctions() []*function {
	out := make([]*function, 0, len(s.functions))
	for _, fn := range s.functions {
		if fn.decl.Body != nil {
			out = append(out, fn)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].key < out[j].key })
	return out
}
