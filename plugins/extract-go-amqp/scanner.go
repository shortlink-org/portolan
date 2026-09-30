package extractgoamqp

import "github.com/shortlink-org/portolan/internal/goscan"

// The two clients read, by import path: rabbitmq/amqp091-go is the
// maintained fork of streadway/amqp, with the same API.
const (
	amqp091Pkg   = "github.com/rabbitmq/amqp091-go"
	streadwayPkg = "github.com/streadway/amqp"
)

var amqpPkgs = []string{amqp091Pkg, streadwayPkg}

// hops is how far up the callers an exchange, a routing key or a queue is
// followed. One hop is the port: the adapter takes the value as a parameter
// and the assembly passes a constant. Two is an assembly that itself was
// handed it. Further than that is not a declaration any more.
const hops = 2

// scanner is the shared Go index, told what the client hands back, what its
// exchange-type constants are worth and how a port names its message.
type scanner struct {
	*goscan.Index
}

func newScanner(tree *goscan.Tree) *scanner {
	tree.Foreign = foreign
	index := goscan.NewIndex(tree)
	index.KnownResults = knownResults()
	index.Companion = companionString
	index.Hops = hops
	return &scanner{Index: index}
}

// knownResults is what the client constructors hand back, since their
// declarations are not in the tree.
func knownResults() map[string][]string {
	out := map[string][]string{}
	for _, pkg := range amqpPkgs {
		for _, dial := range []string{"Dial", "DialTLS", "DialConfig", "DialTLS_ExternalAuth"} {
			out[pkg+"."+dial] = []string{pkg + ".Connection", "error"}
		}
		out[pkg+".Connection.Channel"] = []string{pkg + ".Channel", "error"}
		out[pkg+".Channel.QueueDeclare"] = []string{pkg + ".Queue", "error"}
		out[pkg+".Channel.QueueDeclarePassive"] = []string{pkg + ".Queue", "error"}
	}
	return out
}

// foreign is what the client's exchange-type constants are worth:
// amqp.ExchangeFanout is "fanout", and nothing in the tree says so.
func foreign(importPath, name string) (string, bool) {
	if importPath != amqp091Pkg && importPath != streadwayPkg {
		return "", false
	}
	switch name {
	case "ExchangeDirect":
		return "direct", true
	case "ExchangeFanout":
		return "fanout", true
	case "ExchangeTopic":
		return "topic", true
	case "ExchangeHeaders":
		return "headers", true
	}
	return "", false
}

// companionString is the one string parameter beside the value, or -1 when
// there is none or more than one. A call site that passes a literal or
// constant for it is taken to name the message - the shape of a bus port,
// Publish(ctx, routingKey, name, payload).
func companionString(fn *goscan.Function, value int) int {
	found := -1
	for i, param := range fn.Params {
		if i == value || fn.Types[param] != "string" {
			continue
		}
		if found >= 0 {
			return -1
		}
		found = i
	}
	return found
}
