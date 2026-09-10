package extractgonats

import (
	"go/ast"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
)

// natsCall is one method of nats.go the reader knows: which way messages go,
// and where in the arguments the subject is - directly, inside a *nats.Msg,
// or inside a consumer config.
type natsCall struct {
	direction catalog.ChannelDirection
	api       string
	subject   int
	message   int
	config    int
	queue     int
	durable   int
}

func core(direction catalog.ChannelDirection, subject, queue int) natsCall {
	return natsCall{direction: direction, api: "NATS", subject: subject, message: -1, config: -1, queue: queue, durable: -1}
}

func coreMsg(direction catalog.ChannelDirection, message int) natsCall {
	return natsCall{direction: direction, api: "NATS", subject: -1, message: message, config: -1, queue: -1, durable: -1}
}

func stream(direction catalog.ChannelDirection, subject, queue, durable int) natsCall {
	return natsCall{direction: direction, api: "JetStream", subject: subject, message: -1, config: -1, queue: queue, durable: durable}
}

func streamMsg(message int) natsCall {
	return natsCall{direction: catalog.ChannelSend, api: "JetStream", subject: -1, message: message, config: -1, queue: -1, durable: -1}
}

func consumer(config int) natsCall {
	return natsCall{direction: catalog.ChannelReceive, api: "JetStream", subject: -1, message: -1, config: config, queue: -1, durable: -1}
}

// natsCalls is the surface read, by the type a method is called on. The
// type is what decides: a service's own bus port has a Subscribe too, and
// it is not this one.
var natsCalls = map[string]map[string]natsCall{
	natsPkg + ".Conn": {
		"Subscribe":          core(catalog.ChannelReceive, 0, -1),
		"SubscribeSync":      core(catalog.ChannelReceive, 0, -1),
		"ChanSubscribe":      core(catalog.ChannelReceive, 0, -1),
		"QueueSubscribe":     core(catalog.ChannelReceive, 0, 1),
		"QueueSubscribeSync": core(catalog.ChannelReceive, 0, 1),
		"ChanQueueSubscribe": core(catalog.ChannelReceive, 0, 1),
		"Publish":            core(catalog.ChannelSend, 0, -1),
		"Request":            core(catalog.ChannelSend, 0, -1),
		"PublishMsg":         coreMsg(catalog.ChannelSend, 0),
		"RequestMsg":         coreMsg(catalog.ChannelSend, 0),
	},
	natsPkg + ".JetStreamContext": {
		"Subscribe":          stream(catalog.ChannelReceive, 0, -1, -1),
		"SubscribeSync":      stream(catalog.ChannelReceive, 0, -1, -1),
		"ChanSubscribe":      stream(catalog.ChannelReceive, 0, -1, -1),
		"QueueSubscribe":     stream(catalog.ChannelReceive, 0, 1, -1),
		"QueueSubscribeSync": stream(catalog.ChannelReceive, 0, 1, -1),
		"ChanQueueSubscribe": stream(catalog.ChannelReceive, 0, 1, -1),
		"PullSubscribe":      stream(catalog.ChannelReceive, 0, -1, 1),
		"Publish":            stream(catalog.ChannelSend, 0, -1, -1),
		"PublishAsync":       stream(catalog.ChannelSend, 0, -1, -1),
		"PublishMsg":         streamMsg(0),
		"PublishMsgAsync":    streamMsg(0),
	},
	jsPkg + ".JetStream": {
		"Publish":                stream(catalog.ChannelSend, 1, -1, -1),
		"PublishAsync":           stream(catalog.ChannelSend, 1, -1, -1),
		"PublishMsg":             streamMsg(1),
		"PublishMsgAsync":        streamMsg(1),
		"CreateOrUpdateConsumer": consumer(2),
		"CreateConsumer":         consumer(2),
		"UpdateConsumer":         consumer(2),
		"OrderedConsumer":        consumer(2),
	},
	jsPkg + ".Stream": {
		"CreateOrUpdateConsumer": consumer(1),
		"CreateConsumer":         consumer(1),
		"UpdateConsumer":         consumer(1),
		"OrderedConsumer":        consumer(1),
	},
}

// site is one nats.go call as found: where, which way, and the expressions
// that name the subject, the queue group and the durable consumer - still
// expressions, since what they are worth may be decided by a caller.
type site struct {
	fn         *goscan.Function
	method     string
	direction  catalog.ChannelDirection
	api        string
	configured bool
	subjects   []ast.Expr
	queue      ast.Expr
	durable    ast.Expr
	at         goscan.Source
}

// sites is every nats.go call in the tree, in source order.
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
			spec, known := natsCalls[s.TypeOf(sel.X, fn)][sel.Sel.Name]
			if !known {
				return true
			}
			out = append(out, s.site(fn, call, sel.Sel.Name, spec))
			return true
		})
	}
	return out
}

func (s *scanner) site(fn *goscan.Function, call *ast.CallExpr, method string, spec natsCall) site {
	found := site{fn: fn, method: method, direction: spec.direction, api: spec.api, at: s.At(call.Pos())}
	arg := func(index int) ast.Expr {
		if index >= 0 && index < len(call.Args) {
			return call.Args[index]
		}
		return nil
	}
	if subject := arg(spec.subject); subject != nil {
		found.subjects = []ast.Expr{subject}
	}
	if message := arg(spec.message); message != nil {
		if subject := s.messageSubject(message, fn, map[string]bool{}); subject != nil {
			found.subjects = []ast.Expr{subject}
		}
	}
	if config := arg(spec.config); config != nil {
		found.configured = true
		found.subjects, found.durable = s.consumerConfig(config, fn)
	}
	found.queue = arg(spec.queue)
	if found.durable == nil {
		found.durable = arg(spec.durable)
	}
	// The legacy API takes the durable name as an option.
	for _, option := range call.Args {
		if optionCall, ok := option.(*ast.CallExpr); ok && s.ExternalKey(optionCall, fn) == natsPkg+".Durable" && len(optionCall.Args) == 1 {
			found.durable = optionCall.Args[0]
		}
	}
	return found
}

// messageSubject is the subject a *nats.Msg was built with: nats.NewMsg(x),
// &nats.Msg{Subject: x}, or a local that was given one of those.
func (s *scanner) messageSubject(expr ast.Expr, fn *goscan.Function, seen map[string]bool) ast.Expr {
	switch value := goscan.Unwrap(expr).(type) {
	case *ast.CallExpr:
		if s.ExternalKey(value, fn) == natsPkg+".NewMsg" && len(value.Args) == 1 {
			return value.Args[0]
		}
	case *ast.CompositeLit:
		if s.TypeKey(value.Type, fn.File) == natsPkg+".Msg" {
			return field(value, "Subject")
		}
	case *ast.Ident:
		if seen[value.Name] {
			return nil
		}
		seen[value.Name] = true
		if given, ok := s.AssignedTo(fn, value.Name); ok && given.Index == 0 {
			return s.messageSubject(given.Expr, fn, seen)
		}
	}
	return nil
}

// consumerConfig is what a JetStream consumer config filters on and is
// called: FilterSubject, or each of FilterSubjects, and Durable.
func (s *scanner) consumerConfig(expr ast.Expr, fn *goscan.Function) (subjects []ast.Expr, durable ast.Expr) {
	lit, ok := goscan.Unwrap(expr).(*ast.CompositeLit)
	if !ok {
		if ident, isIdent := goscan.Unwrap(expr).(*ast.Ident); isIdent {
			if given, found := s.AssignedTo(fn, ident.Name); found && given.Index == 0 {
				lit, ok = goscan.Unwrap(given.Expr).(*ast.CompositeLit)
			}
		}
	}
	if !ok {
		return nil, nil
	}
	if single := field(lit, "FilterSubject"); single != nil {
		subjects = append(subjects, single)
	}
	if many, isList := goscan.Unwrap(field(lit, "FilterSubjects")).(*ast.CompositeLit); isList {
		subjects = append(subjects, many.Elts...)
	}
	return subjects, field(lit, "Durable")
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
