package extractgoamqp

import (
	"go/ast"
	"strconv"

	"github.com/shortlink-org/portolan/internal/goscan"
)

// What a call on *amqp.Channel does, as far as routes go.
const (
	publish = "publish"
	consume = "consume"
	bind    = "bind"
	declare = "declare"
)

// amqpCall is one method of *amqp.Channel the reader knows: what it does,
// and where in the arguments the exchange, the routing key, the queue and -
// for ExchangeDeclare - the exchange's type are. -1 where there is none.
type amqpCall struct {
	does     string
	exchange int
	key      int
	queue    int
	kind     int
}

// amqpCalls is the surface read, on *amqp.Channel and nothing else: a
// service's own bus port has a Publish too, and it is not this one.
var amqpCalls = map[string]amqpCall{
	"Publish":                               {does: publish, exchange: 0, key: 1, queue: -1, kind: -1},
	"PublishWithContext":                    {does: publish, exchange: 1, key: 2, queue: -1, kind: -1},
	"PublishWithDeferredConfirm":            {does: publish, exchange: 0, key: 1, queue: -1, kind: -1},
	"PublishWithDeferredConfirmWithContext": {does: publish, exchange: 1, key: 2, queue: -1, kind: -1},
	"Consume":                               {does: consume, exchange: -1, key: -1, queue: 0, kind: -1},
	"ConsumeWithContext":                    {does: consume, exchange: -1, key: -1, queue: 1, kind: -1},
	"Get":                                   {does: consume, exchange: -1, key: -1, queue: 0, kind: -1},
	"QueueBind":                             {does: bind, exchange: 2, key: 1, queue: 0, kind: -1},
	"ExchangeDeclare":                       {does: declare, exchange: 0, key: -1, queue: -1, kind: 1},
	"ExchangeDeclarePassive":                {does: declare, exchange: 0, key: -1, queue: -1, kind: 1},
}

// site is one call on *amqp.Channel as found: where, what it does, and the
// expressions that name the exchange, the routing key and the queue - still
// expressions, since what they are worth may be decided by a caller.
type site struct {
	fn       *goscan.Function
	method   string
	pkg      string
	does     string
	exchange ast.Expr
	key      ast.Expr
	queue    ast.Expr
	kind     ast.Expr
	at       goscan.Source
}

// sites is every call on *amqp.Channel in the tree, in source order.
func (s *scanner) sites() []site {
	var out []site
	for _, fn := range s.SortedFunctions() {
		ast.Inspect(fn.Decl.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			spec, known := amqpCalls[sel.Sel.Name]
			if !known {
				return true
			}
			receiver := s.TypeOf(sel.X, fn)
			pkg := ""
			for _, candidate := range amqpPkgs {
				if receiver == candidate+".Channel" {
					pkg = candidate
				}
			}
			if pkg == "" {
				return true
			}
			arg := func(index int) ast.Expr {
				if index >= 0 && index < len(call.Args) {
					return call.Args[index]
				}
				return nil
			}
			out = append(out, site{
				fn: fn, method: sel.Sel.Name, pkg: pkg, does: spec.does,
				exchange: arg(spec.exchange), key: arg(spec.key), queue: arg(spec.queue), kind: arg(spec.kind),
				at: s.At(call.Pos()),
			})
			return true
		})
	}
	return out
}

// queueRef is one queue a consume or a binding names: by its name, or - for
// a queue the server names, QueueDeclare("", ...) - by where it was
// declared, which is how a binding and a consume of the same `q.Name` meet.
type queueRef struct {
	key       string
	name      string
	anonymous bool
	at        goscan.Source
}

// queueRefs is every queue an expression can be. `q.Name` of a local given
// QueueDeclare is read as the name QueueDeclare was asked for.
func (s *scanner) queueRefs(expr ast.Expr, fn *goscan.Function) []queueRef {
	if expr == nil {
		return nil
	}
	if declared := s.declaredQueue(expr, fn); declared != nil {
		var out []queueRef
		declAt := s.At(declared.Pos())
		if len(declared.Args) == 0 {
			return nil
		}
		for _, value := range s.values(declared.Args[0], fn, 0) {
			if value.Value == "" {
				out = append(out, queueRef{key: "@" + declAt.String(), anonymous: true, at: declAt})
				continue
			}
			out = append(out, queueRef{key: value.Value, name: value.Value, at: value.At})
		}
		return out
	}
	var out []queueRef
	for _, value := range s.values(expr, fn, 0) {
		if value.Value != "" {
			out = append(out, queueRef{key: value.Value, name: value.Value, at: value.At})
		}
	}
	return out
}

// declaredQueue is the QueueDeclare call a `q.Name` reads, when q is a local
// given one.
func (s *scanner) declaredQueue(expr ast.Expr, fn *goscan.Function) *ast.CallExpr {
	sel, ok := goscan.Unwrap(expr).(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Name" {
		return nil
	}
	ident, ok := goscan.Unwrap(sel.X).(*ast.Ident)
	if !ok {
		return nil
	}
	given, ok := s.AssignedTo(fn, ident.Name)
	if !ok || given.Index != 0 {
		return nil
	}
	call, ok := goscan.Unwrap(given.Expr).(*ast.CallExpr)
	if !ok {
		return nil
	}
	key := s.ExternalKey(call, fn)
	for _, pkg := range amqpPkgs {
		if key == pkg+".Channel.QueueDeclare" || key == pkg+".Channel.QueueDeclarePassive" {
			return call
		}
	}
	return nil
}

// route is one exchange and routing key a publish or a binding can name.
// keyless is a key this reader could not follow, which only a fanout or
// headers exchange can do without.
type route struct {
	exchange goscan.Resolved
	key      goscan.Resolved
	keyless  bool
}

// routes is every exchange and routing key a pair of expressions can be.
// When both are parameters of the function, they are read together at each
// caller, so that one caller's exchange never meets another caller's key.
func (s *scanner) routes(exchange, key ast.Expr, fn *goscan.Function, depth int, visiting map[string]bool) []route {
	if ia, ib := paramOf(exchange, fn), paramOf(key, fn); ia >= 0 && ib >= 0 {
		if depth >= s.Hops {
			return nil
		}
		guard := fn.Key + "#route:" + strconv.Itoa(ia) + ":" + strconv.Itoa(ib)
		if visiting[guard] {
			return nil
		}
		visiting[guard] = true
		defer delete(visiting, guard)
		var out []route
		for _, caller := range s.CallSites(fn) {
			if args := caller.Call.Args; ia < len(args) && ib < len(args) {
				out = append(out, s.routes(args[ia], args[ib], caller.Fn, depth+1, visiting)...)
			}
		}
		return out
	}
	exchanges := s.values(exchange, fn, depth)
	keys := s.values(key, fn, depth)
	// A key that is `q.Name` is the queue QueueDeclare was asked for - the
	// default exchange's shape, Publish("", q.Name, ...).
	if declared := s.declaredQueue(key, fn); declared != nil && len(declared.Args) > 0 {
		keys = s.values(declared.Args[0], fn, depth)
	}
	var out []route
	for _, ex := range exchanges {
		if len(keys) == 0 {
			out = append(out, route{exchange: ex, keyless: true})
			continue
		}
		for _, k := range keys {
			out = append(out, route{exchange: ex, key: k})
		}
	}
	return out
}

func paramOf(expr ast.Expr, fn *goscan.Function) int {
	if ident, ok := goscan.Unwrap(expr).(*ast.Ident); ok {
		return goscan.ParamIndex(fn, ident.Name)
	}
	return -1
}

// values is every string an expression can be worth, from where it was
// written. A field of the receiver is read at the constructor that filled
// it.
func (s *scanner) values(expr ast.Expr, fn *goscan.Function, depth int) []goscan.Resolved {
	if expr == nil {
		return nil
	}
	visiting := map[string]bool{}
	if found := s.Resolve(expr, fn, depth, visiting); len(found) > 0 {
		return found
	}
	if sel, ok := goscan.Unwrap(expr).(*ast.SelectorExpr); ok {
		return s.fromConstructors(sel, fn, visiting)
	}
	return nil
}

// fromConstructors is what a field of a tree struct was given where the
// struct was built: a composite literal or a field assignment in a function
// that returns the type. That is the publisher's shape - the exchange comes
// in at New and is read at Publish - and the constructor's parameter is
// followed to its callers like any other.
func (s *scanner) fromConstructors(sel *ast.SelectorExpr, fn *goscan.Function, visiting map[string]bool) []goscan.Resolved {
	key := s.TypeOf(sel.X, fn)
	if s.Structs[key] == nil {
		return nil
	}
	guard := "field:" + key + "." + sel.Sel.Name
	if visiting[guard] {
		return nil
	}
	visiting[guard] = true
	defer delete(visiting, guard)

	var out []goscan.Resolved
	for _, ctor := range s.SortedFunctions() {
		if !returns(ctor, key) {
			continue
		}
		ast.Inspect(ctor.Decl.Body, func(node ast.Node) bool {
			var given ast.Expr
			switch value := node.(type) {
			case *ast.CompositeLit:
				if s.TypeKey(value.Type, ctor.File) == key {
					given = field(value, sel.Sel.Name)
				}
			case *ast.AssignStmt:
				for i, lhs := range value.Lhs {
					target, ok := lhs.(*ast.SelectorExpr)
					if ok && target.Sel.Name == sel.Sel.Name && s.TypeOf(target.X, ctor) == key && i < len(value.Rhs) && len(value.Lhs) == len(value.Rhs) {
						given = value.Rhs[i]
					}
				}
			}
			if given != nil {
				out = append(out, s.Resolve(given, ctor, 0, visiting)...)
			}
			return true
		})
	}
	return out
}

// returns is whether a function hands the type back, bare or by pointer.
func returns(fn *goscan.Function, key string) bool {
	for _, result := range fn.Results {
		if result == key {
			return true
		}
	}
	return false
}

// field is the value a composite literal gives a named field, or nil.
func field(lit *ast.CompositeLit, name string) ast.Expr {
	if lit == nil {
		return nil
	}
	for _, raw := range lit.Elts {
		pair, ok := raw.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if key, ok := pair.Key.(*ast.Ident); ok && key.Name == name {
			return pair.Value
		}
	}
	return nil
}
