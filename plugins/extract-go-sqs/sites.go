package extractgosqs

import (
	"go/ast"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
)

// sqsCall is one method of the SQS client the reader knows: which way
// messages go, and whether one call carries several.
type sqsCall struct {
	direction catalog.ChannelDirection
	batch     bool
}

// sqsCalls is the surface read, on *sqs.Client and nothing else: a
// service's own queue port has a Send too, and it is not this one. The queue
// is always the QueueUrl field of the input struct, the second argument.
var sqsCalls = map[string]sqsCall{
	"SendMessage":      {direction: catalog.ChannelSend},
	"SendMessageBatch": {direction: catalog.ChannelSend, batch: true},
	"ReceiveMessage":   {direction: catalog.ChannelReceive},
}

// site is one SQS call as found: where, which way, and the expression that
// names the queue - still an expression, since what it is worth may be
// decided by a caller or a constructor.
type site struct {
	fn        *goscan.Function
	method    string
	direction catalog.ChannelDirection
	batch     bool
	queue     ast.Expr
	at        goscan.Source
}

// sites is every SQS call in the tree, in source order.
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
			spec, known := sqsCalls[sel.Sel.Name]
			if !known || s.TypeOf(sel.X, fn) != sqsPkg+".Client" {
				return true
			}
			found := site{fn: fn, method: sel.Sel.Name, direction: spec.direction, batch: spec.batch, at: s.At(call.Pos())}
			if len(call.Args) >= 2 {
				found.queue = s.inputField(call.Args[1], fn, "QueueUrl")
			}
			out = append(out, found)
			return true
		})
	}
	return out
}

// inputField is the value an SDK input struct gives a field: written inline
// as &sqs.XInput{...}, or built into a local first.
func (s *scanner) inputField(expr ast.Expr, fn *goscan.Function, name string) ast.Expr {
	lit, ok := goscan.Unwrap(expr).(*ast.CompositeLit)
	if !ok {
		if ident, isIdent := goscan.Unwrap(expr).(*ast.Ident); isIdent {
			if given, found := s.AssignedTo(fn, ident.Name); found && given.Index == 0 {
				lit, ok = goscan.Unwrap(given.Expr).(*ast.CompositeLit)
			}
		}
	}
	if !ok {
		return nil
	}
	return field(lit, name)
}

// values is every string a queue expression can be worth, from where it was
// written. The SDK wraps a string in aws.String and hands a URL back from
// GetQueueUrl; both are taken off first, so that what reaches the shared
// index is a plain string expression it knows how to follow. A field of the
// receiver is read at the constructor that filled it.
func (s *scanner) values(expr ast.Expr, fn *goscan.Function) []goscan.Resolved {
	visiting := map[string]bool{}
	plain := s.follow(expr, fn, map[string]bool{})
	if plain == nil {
		return nil
	}
	if found := s.Resolve(plain, fn, 0, visiting); len(found) > 0 {
		return found
	}
	if sel, ok := goscan.Unwrap(plain).(*ast.SelectorExpr); ok {
		return s.fromConstructors(sel, fn, visiting)
	}
	return nil
}

// follow takes the SDK's own wrapping off a queue expression: aws.String and
// aws.ToString, a local given one of those, and the QueueUrl of a
// GetQueueUrl result, which is read as the QueueName that was asked for.
func (s *scanner) follow(expr ast.Expr, fn *goscan.Function, seen map[string]bool) ast.Expr {
	for {
		expr = goscan.Unwrap(expr)
		switch value := expr.(type) {
		case *ast.CallExpr:
			key := s.ExternalKey(value, fn)
			if (key == awsPkg+".String" || key == awsPkg+".ToString") && len(value.Args) == 1 {
				expr = value.Args[0]
				continue
			}
			return expr
		case *ast.Ident:
			if goscan.ParamIndex(fn, value.Name) >= 0 || seen[value.Name] {
				return expr
			}
			seen[value.Name] = true
			given, ok := s.AssignedTo(fn, value.Name)
			if !ok || given.Index != 0 {
				return expr
			}
			expr = given.Expr
		case *ast.SelectorExpr:
			if value.Sel.Name != "QueueUrl" {
				return expr
			}
			asked := s.askedQueueName(value.X, fn)
			if asked == nil {
				return expr
			}
			expr = asked
		default:
			return expr
		}
	}
}

// askedQueueName is the QueueName a GetQueueUrl call was given, when expr is
// the local its output was assigned to.
func (s *scanner) askedQueueName(expr ast.Expr, fn *goscan.Function) ast.Expr {
	ident, ok := goscan.Unwrap(expr).(*ast.Ident)
	if !ok {
		return nil
	}
	given, ok := s.AssignedTo(fn, ident.Name)
	if !ok || given.Index != 0 {
		return nil
	}
	call, ok := goscan.Unwrap(given.Expr).(*ast.CallExpr)
	if !ok || s.ExternalKey(call, fn) != sqsPkg+".Client.GetQueueUrl" || len(call.Args) < 2 {
		return nil
	}
	return s.inputField(call.Args[1], fn, "QueueName")
}

// fromConstructors is what a field of a tree struct was given where the
// struct was built: a composite literal or a field assignment in a function
// that returns the type. That is the worker's shape - the queue comes in at
// New and is read at Run - and the constructor's parameter is followed to
// its callers like any other.
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
			if given == nil {
				return true
			}
			if plain := s.follow(given, ctor, map[string]bool{}); plain != nil {
				out = append(out, s.Resolve(plain, ctor, 0, visiting)...)
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

// queueName is the name a queue goes by on the page. SQS addresses a queue
// by URL - https://sqs.<region>.amazonaws.com/<account>/<name> - and the
// name is its last segment; a bare name is kept as written.
func queueName(value string) string {
	if !strings.Contains(value, "://") {
		return value
	}
	trimmed := strings.TrimRight(value, "/")
	return trimmed[strings.LastIndex(trimmed, "/")+1:]
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
