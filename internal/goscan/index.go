package goscan

import (
	"go/ast"
	"go/token"
	"reflect"
	"sort"
	"strconv"
)

// StructType is a struct as a reader needs it: what type each field has, so
// that `b.conn` is known to be a connection, and what a field defaults to
// when its tag says, so that a subject or a topic read off config resolves.
type StructType struct {
	Key      string
	Fields   map[string]string
	Defaults map[string]string
	// Env is the environment variable a field is configured by, when its
	// `envconfig` or `env` tag says; documentation for the default's origin.
	Env map[string]string
}

// Function is one declared function or method: its parameters by name and
// type, what it returns, and what its body assigns to which name.
type Function struct {
	Key      string
	Name     string
	Receiver string
	File     *File
	Decl     *ast.FuncDecl
	Params   []string
	Types    map[string]string
	Results  []string
	assigned map[string]Assignment
}

// Assignment is the last thing a local name was given: the expression, and
// which of its values when the expression yields several.
type Assignment struct {
	Expr  ast.Expr
	Index int
}

// Resolved is one string an expression was found to be, where it was
// written, and - when it came through a wrapper that also names the message -
// what the message is called.
type Resolved struct {
	Value string
	At    Source
	Name  string
}

// CallArg is one expression a caller passes for a parameter, with the
// function it is written in, so that it can be read in that function's scope.
type CallArg struct {
	Expr ast.Expr
	Fn   *Function
	Call *ast.CallExpr
}

// Index is the tree, and the declarations in it a call is read against:
// the structs with their field types and defaults, the interfaces by their
// method names, and every function with what it takes and returns. It is
// what lets an extractor follow a value through a local, a field, a
// constructor and a parameter up to the caller that passed it - the same
// walk for a NATS subject, a Watermill topic and a River queue.
type Index struct {
	*Tree
	Structs    map[string]*StructType
	Interfaces map[string][]string
	// Named is every type the tree declares, by key, whatever its shape.
	Named     map[string]bool
	Functions map[string]*Function
	Methods   map[string][]*Function
	ByName    map[string][]*Function
	// KnownResults is what constructors outside the tree hand back, by
	// "<import path>.<Func>" or "<type key>.<Method>": nats.Connect gives a
	// *nats.Conn, and nothing in the tree says so. Set by the extractor.
	KnownResults map[string][]string
	// Companion, when set, is which other parameter of fn names the message
	// carried beside the value at index - the shape of a bus port,
	// Subscribe(subject, name, handler). -1 when there is none.
	Companion func(fn *Function, index int) int
	// Hops is how far up the callers a parameter is followed. One hop is the
	// port: the adapter takes the value as a parameter and the assembly
	// passes a constant. Two is an assembly that itself was handed it.
	// Further than that is not a declaration any more.
	Hops int
	// typing is the locals whose type is being worked out right now, so a
	// name shadowed by an expression of itself - `js := js.Sub()` in an
	// inner block - ends rather than recurses.
	typing map[string]bool
}

// NewIndex reads every type and function declaration of the tree.
func NewIndex(tree *Tree) *Index {
	s := &Index{
		Tree:       tree,
		Structs:    map[string]*StructType{},
		Interfaces: map[string][]string{},
		Named:      map[string]bool{},
		Functions:  map[string]*Function{},
		Methods:    map[string][]*Function{},
		ByName:     map[string][]*Function{},
		Hops:       2,
		typing:     map[string]bool{},
	}
	for _, file := range tree.Files {
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
	return s
}

func (s *Index) indexType(file *File, spec *ast.TypeSpec) {
	key := file.Pkg + "." + spec.Name.Name
	s.Named[key] = true
	switch body := spec.Type.(type) {
	case *ast.StructType:
		st := &StructType{Key: key, Fields: map[string]string{}, Defaults: map[string]string{}, Env: map[string]string{}}
		for _, field := range body.Fields.List {
			typeKey := s.TypeKey(field.Type, file)
			def, env := "", ""
			if field.Tag != nil {
				text, _ := strconv.Unquote(field.Tag.Value)
				tag := reflect.StructTag(text)
				def = tag.Get("default")
				env = FirstNonEmpty(tag.Get("envconfig"), tag.Get("env"))
			}
			for _, name := range field.Names {
				st.Fields[name.Name] = typeKey
				if def != "" {
					st.Defaults[name.Name] = def
				}
				if env != "" {
					st.Env[name.Name] = env
				}
			}
		}
		s.Structs[key] = st
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
		s.Interfaces[key] = names
	}
}

func (s *Index) indexFunction(file *File, decl *ast.FuncDecl) {
	key := file.Pkg + "." + decl.Name.Name
	receiver := ""
	if decl.Recv != nil && len(decl.Recv.List) > 0 {
		receiver = s.TypeKey(decl.Recv.List[0].Type, file)
		key = receiver + "." + decl.Name.Name
	}
	fn := &Function{Key: key, Name: decl.Name.Name, Receiver: receiver, File: file, Decl: decl, Types: map[string]string{}}
	if decl.Recv != nil {
		for _, field := range decl.Recv.List {
			for _, name := range field.Names {
				fn.Types[name.Name] = receiver
			}
		}
	}
	if decl.Type.Params != nil {
		for _, field := range decl.Type.Params.List {
			typeKey := s.TypeKey(field.Type, file)
			for _, name := range field.Names {
				fn.Params = append(fn.Params, name.Name)
				fn.Types[name.Name] = typeKey
			}
		}
	}
	if decl.Type.Results != nil {
		for _, field := range decl.Type.Results.List {
			typeKey := s.TypeKey(field.Type, file)
			if len(field.Names) == 0 {
				fn.Results = append(fn.Results, typeKey)
			}
			for range field.Names {
				fn.Results = append(fn.Results, typeKey)
			}
		}
	}
	s.Functions[key] = fn
	if receiver != "" {
		s.Methods[receiver] = append(s.Methods[receiver], fn)
		s.ByName[fn.Name] = append(s.ByName[fn.Name], fn)
	}
}

// Implements is whether a receiver type has every method an interface asks
// for, by name. Names are what a port is: a type with the right names is
// what the assembly hands over, and the compiler holds the signatures.
func (s *Index) Implements(receiver, iface string) bool {
	want := s.Interfaces[iface]
	if len(want) == 0 {
		return false
	}
	have := map[string]bool{}
	for _, fn := range s.Methods[receiver] {
		have[fn.Name] = true
	}
	for _, name := range want {
		if !have[name] {
			return false
		}
	}
	return true
}

// AssignedTo is the last expression a local name was given in the function,
// read once per function.
func (s *Index) AssignedTo(fn *Function, name string) (Assignment, bool) {
	if fn.assigned == nil {
		fn.assigned = map[string]Assignment{}
		if fn.Decl.Body != nil {
			ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
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

func record(into map[string]Assignment, lhs, rhs []ast.Expr) {
	if len(rhs) == 0 {
		return
	}
	for i, target := range lhs {
		ident, ok := target.(*ast.Ident)
		if !ok || ident.Name == "_" {
			continue
		}
		if len(rhs) == 1 && len(lhs) > 1 {
			into[ident.Name] = Assignment{Expr: rhs[0], Index: i}
		} else if i < len(rhs) {
			into[ident.Name] = Assignment{Expr: rhs[i]}
		}
	}
}

// TypeOf is the type key of an expression, as far as declarations say: a
// parameter or receiver by its declared type, a local by what it was
// assigned, a field by its struct, a call by what the callee returns.
func (s *Index) TypeOf(expr ast.Expr, fn *Function) string {
	switch value := Unwrap(expr).(type) {
	case *ast.Ident:
		if kind := fn.Types[value.Name]; kind != "" {
			return kind
		}
		key := fn.Key + ":" + value.Name
		if s.typing[key] {
			return ""
		}
		s.typing[key] = true
		defer delete(s.typing, key)
		if given, ok := s.AssignedTo(fn, value.Name); ok {
			if call, isCall := Unwrap(given.Expr).(*ast.CallExpr); isCall {
				results := s.ResultsOf(call, fn)
				if given.Index < len(results) {
					return results[given.Index]
				}
				return ""
			}
			if given.Index == 0 {
				return s.TypeOf(given.Expr, fn)
			}
		}
	case *ast.CompositeLit:
		return s.TypeKey(value.Type, fn.File)
	case *ast.SelectorExpr:
		if st := s.Structs[s.TypeOf(value.X, fn)]; st != nil {
			return st.Fields[value.Sel.Name]
		}
	case *ast.CallExpr:
		if results := s.ResultsOf(value, fn); len(results) > 0 {
			return results[0]
		}
	}
	return ""
}

// ResultsOf is what a call returns: the callee's declared results when it is
// in the tree, KnownResults when it is a library's.
func (s *Index) ResultsOf(call *ast.CallExpr, fn *Function) []string {
	for _, target := range s.Callees(call, fn) {
		return target.Results
	}
	if key := s.ExternalKey(call, fn); key != "" {
		return s.KnownResults[key]
	}
	return nil
}

// ExternalKey names a call on something declared outside the tree: a
// package function by import path, a method by the type of what it is
// called on.
func (s *Index) ExternalKey(call *ast.CallExpr, fn *Function) string {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	if base, ok := sel.X.(*ast.Ident); ok {
		if imported := fn.File.Imports[base.Name]; imported != "" && fn.Types[base.Name] == "" {
			if _, local := s.AssignedTo(fn, base.Name); !local {
				return imported + "." + sel.Sel.Name
			}
		}
	}
	if recv := s.TypeOf(sel.X, fn); recv != "" {
		return recv + "." + sel.Sel.Name
	}
	return ""
}

// Callees is every function in the tree a call may reach: the one named,
// when it is a plain function or a method on a known type; every
// implementation, when it is a method on an interface the tree declares.
func (s *Index) Callees(call *ast.CallExpr, fn *Function) []*Function {
	return s.Targets(call.Fun, fn)
}

// Targets is every function an expression names - the same as Callees, for
// a function value that is passed rather than called: `h.Handle` handed to a
// router, `consume` handed to a subscriber.
func (s *Index) Targets(expr ast.Expr, fn *Function) []*Function {
	switch callee := Unwrap(expr).(type) {
	case *ast.Ident:
		if target := s.Functions[fn.File.Pkg+"."+callee.Name]; target != nil {
			return []*Function{target}
		}
	case *ast.SelectorExpr:
		if base, ok := callee.X.(*ast.Ident); ok && fn.Types[base.Name] == "" {
			if imported := fn.File.Imports[base.Name]; imported != "" {
				if _, local := s.AssignedTo(fn, base.Name); !local {
					if target := s.Functions[imported+"."+callee.Sel.Name]; target != nil {
						return []*Function{target}
					}
					return nil
				}
			}
		}
		recv := s.TypeOf(callee.X, fn)
		if recv == "" {
			return nil
		}
		if target := s.Functions[recv+"."+callee.Sel.Name]; target != nil {
			return []*Function{target}
		}
		if s.Interfaces[recv] != nil {
			var out []*Function
			for _, candidate := range s.ByName[callee.Sel.Name] {
				if s.Implements(candidate.Receiver, recv) {
					out = append(out, candidate)
				}
			}
			sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
			return out
		}
	}
	return nil
}

// ParamIndex is which parameter a name is, or -1.
func ParamIndex(fn *Function, name string) int {
	for i, param := range fn.Params {
		if param == name {
			return i
		}
	}
	return -1
}

// SortedFunctions is every function with a body, in a fixed order.
func (s *Index) SortedFunctions() []*Function {
	out := make([]*Function, 0, len(s.Functions))
	for _, fn := range s.Functions {
		if fn.Decl.Body != nil {
			out = append(out, fn)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// SingleReturn is the expression a function is, when its whole body is
// `return x`: the Name() of an event, the Topic() of a message.
func SingleReturn(fn *Function) ast.Expr {
	if fn.Decl.Body == nil || len(fn.Decl.Body.List) != 1 {
		return nil
	}
	ret, ok := fn.Decl.Body.List[0].(*ast.ReturnStmt)
	if !ok || len(ret.Results) != 1 {
		return nil
	}
	return ret.Results[0]
}

// Resolve is the strings an expression can be worth: a literal; a constant,
// the tree's own or an imported one; a config field's default; a call to a
// function whose body is one return; a `string(x)` conversion of any of
// those; a concatenation of them; a parameter, by what every caller passes
// for it. Empty when it is none of those - never a guess.
func (s *Index) Resolve(expr ast.Expr, fn *Function, depth int, visiting map[string]bool) []Resolved {
	at := s.At(expr.Pos())
	switch value := Unwrap(expr).(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, _ := strconv.Unquote(value.Value)
			return []Resolved{{Value: text, At: at}}
		}
	case *ast.Ident:
		if index := ParamIndex(fn, value.Name); index >= 0 {
			return s.FromCallers(fn, index, depth, visiting)
		}
		key := fn.Key + ":" + value.Name
		if visiting[key] {
			return nil
		}
		visiting[key] = true
		defer delete(visiting, key)
		if given, ok := s.AssignedTo(fn, value.Name); ok {
			if given.Index == 0 {
				return s.Resolve(given.Expr, fn, depth, visiting)
			}
			return nil
		}
		if text := s.StringOf(value, fn.File, nil); text != "" {
			return []Resolved{{Value: text, At: at}}
		}
	case *ast.SelectorExpr:
		if text := s.StringOf(value, fn.File, nil); text != "" {
			return []Resolved{{Value: text, At: at}}
		}
		if st := s.Structs[s.TypeOf(value.X, fn)]; st != nil {
			if def := st.Defaults[value.Sel.Name]; def != "" {
				return []Resolved{{Value: def, At: at}}
			}
		}
	case *ast.BinaryExpr:
		if value.Op != token.ADD {
			return nil
		}
		return s.concat(value.X, value.Y, fn, depth, visiting)
	case *ast.CallExpr:
		if ident, ok := value.Fun.(*ast.Ident); ok && ident.Name == "string" && len(value.Args) == 1 && s.Functions[fn.File.Pkg+".string"] == nil {
			return s.Resolve(value.Args[0], fn, depth, visiting)
		}
		var out []Resolved
		for _, target := range s.Callees(value, fn) {
			if ret := SingleReturn(target); ret != nil {
				key := "call:" + target.Key
				if visiting[key] {
					continue
				}
				visiting[key] = true
				out = append(out, s.Resolve(ret, target, depth, visiting)...)
				delete(visiting, key)
			}
		}
		return out
	}
	return nil
}

// concat is every string `x + y` can be, when both halves resolve; a half
// that does not leaves the whole unresolved rather than half-guessed.
func (s *Index) concat(x, y ast.Expr, fn *Function, depth int, visiting map[string]bool) []Resolved {
	left := s.Resolve(x, fn, depth, visiting)
	if len(left) == 0 {
		return nil
	}
	right := s.Resolve(y, fn, depth, visiting)
	if len(right) == 0 {
		return nil
	}
	var out []Resolved
	for _, a := range left {
		for _, b := range right {
			out = append(out, Resolved{Value: a.Value + b.Value, At: a.At, Name: FirstNonEmpty(a.Name, b.Name)})
		}
	}
	return out
}

// FromCallers is what a parameter is worth: whatever each call site passes
// for it, resolved there. When Companion names another parameter, a call
// site that passes a literal or constant for it is taken to name the
// message.
func (s *Index) FromCallers(fn *Function, index, depth int, visiting map[string]bool) []Resolved {
	if depth >= s.Hops {
		return nil
	}
	key := fn.Key + "#" + strconv.Itoa(index)
	if visiting[key] {
		return nil
	}
	visiting[key] = true
	defer delete(visiting, key)

	nameIndex := -1
	if s.Companion != nil {
		nameIndex = s.Companion(fn, index)
	}
	var out []Resolved
	for _, arg := range s.ArgsFromCallers(fn, index) {
		found := s.Resolve(arg.Expr, arg.Fn, depth+1, visiting)
		if nameIndex >= 0 && nameIndex < len(arg.Call.Args) {
			names := s.Resolve(arg.Call.Args[nameIndex], arg.Fn, depth+1, visiting)
			if len(names) == 1 {
				for i := range found {
					found[i].Name = names[0].Value
				}
			}
		}
		out = append(out, found...)
	}
	return out
}

// ArgsFromCallers is every expression a caller passes for fn's parameter at
// index, each with the function it was written in. In a fixed order.
func (s *Index) ArgsFromCallers(fn *Function, index int) []CallArg {
	var out []CallArg
	for _, site := range s.CallSites(fn) {
		if index < len(site.Call.Args) {
			out = append(out, CallArg{Expr: site.Call.Args[index], Fn: site.Fn, Call: site.Call})
		}
	}
	return out
}

// CallSites is every call in the tree that lands on fn, with the function
// it is written in. In a fixed order. Expr is nil: the site is the call.
func (s *Index) CallSites(fn *Function) []CallArg {
	var out []CallArg
	for _, caller := range s.SortedFunctions() {
		ast.Inspect(caller.Decl.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || !s.Reaches(call, caller, fn) {
				return true
			}
			out = append(out, CallArg{Fn: caller, Call: call})
			return true
		})
	}
	return out
}

// Reaches is whether a call lands on fn: directly, or through an interface
// fn's receiver satisfies.
func (s *Index) Reaches(call *ast.CallExpr, caller, fn *Function) bool {
	for _, target := range s.Callees(call, caller) {
		if target == fn {
			return true
		}
	}
	return false
}

// TypesOf is every concrete type an expression can have: TypeOf, or when the
// expression is a parameter of an interface or unnamed type, the types the
// callers pass for it, followed Hops levels up. Empty when nothing says.
func (s *Index) TypesOf(expr ast.Expr, fn *Function, depth int, visiting map[string]bool) []string {
	if ident, ok := Unwrap(expr).(*ast.Ident); ok {
		if index := ParamIndex(fn, ident.Name); index >= 0 && !s.isConcrete(fn.Types[ident.Name]) {
			if depth >= s.Hops {
				return nil
			}
			key := fn.Key + "#type:" + strconv.Itoa(index)
			if visiting[key] {
				return nil
			}
			visiting[key] = true
			defer delete(visiting, key)
			var out []string
			seen := map[string]bool{}
			for _, arg := range s.ArgsFromCallers(fn, index) {
				for _, found := range s.TypesOf(arg.Expr, arg.Fn, depth+1, visiting) {
					if !seen[found] {
						seen[found] = true
						out = append(out, found)
					}
				}
			}
			return out
		}
	}
	if found := s.TypeOf(expr, fn); s.isConcrete(found) {
		return []string{found}
	}
	return nil
}

// isConcrete is whether a type key names a non-interface type the tree
// declares. A library's interface - river.JobArgs - is not declared here and
// so is not concrete either: a parameter of that type says nothing about
// which job it carries, and the callers are asked.
func (s *Index) isConcrete(key string) bool {
	return s.Named[key] && s.Interfaces[key] == nil
}
