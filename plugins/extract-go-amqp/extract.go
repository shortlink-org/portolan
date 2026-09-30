package extractgoamqp

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	tree, err := goscan.Read(in.Root)
	if err != nil {
		return plugin.Response{}, err
	}
	s := newScanner(tree)

	sites := s.sites()
	if len(sites) == 0 {
		b.Warn(in.Root, "no amqp091-go or streadway/amqp call was found")
	}
	channels := s.catalog(sites, b)
	// A site is found under Root and cited from the repository, which is
	// what a source link opens on the forge.
	for i := range channels {
		channels[i].Source = in.RootSource(channels[i].Source)
	}

	serviceID := opts.Context + "." + opts.Service
	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID:   opts.Context,
			Slug: opts.Context,
			Services: []catalog.Service{{
				ID:         serviceID,
				Slug:       opts.Service,
				Provides:   []catalog.RpcService{},
				Consumes:   []catalog.RpcCall{},
				Aggregates: []catalog.Aggregate{},
				Channels:   channels,
			}},
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{},
		Adrs:  []catalog.Adr{},
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(goscan.FirstNonEmpty(opts.Out, "amqp.json"), string(encoded)+"\n")
	return b.Response(), nil
}

// How a channel is addressed. A publisher and a consumer meet on the string
// the broker routes by: the routing key when the exchange routes by key, the
// exchange when it does not look at keys (fanout, headers, or a publish with
// no key), and the queue for the default exchange, which routes a key to
// the queue of that name.
const (
	titleExchange = "AMQP exchange"
	titleKey      = "AMQP routing key"
	titleQueue    = "AMQP queue"
)

// rank orders the titles when two routes land on one address: an exchange
// is the widest thing the string can name.
var rank = map[string]int{titleExchange: 0, titleKey: 1, titleQueue: 2}

// address is the channel a route lands on, what kind it is and what it is
// called. ok is false when the route names nothing: the default exchange
// with no key.
func address(exchange, key string, kinds map[string]string) (string, catalog.ChannelKind, string, bool) {
	switch {
	case exchange == "":
		return key, catalog.ChannelKindMessage, titleQueue, key != ""
	case key == "" || kinds[exchange] == "fanout" || kinds[exchange] == "headers":
		return exchange, catalog.ChannelKindEvent, titleExchange, true
	default:
		return key, catalog.ChannelKindEvent, titleKey, true
	}
}

// binding is a queue bound to an exchange with a key, by QueueBind.
type binding struct {
	route route
	fn    string
}

// channelState is one address as the sites describe it, gathered before it
// is written out.
type channelState struct {
	address   string
	kind      catalog.ChannelKind
	title     string
	pkgs      map[string]bool
	exchanges map[string]bool
	sources   []string
	notes     map[string]bool
	messages  map[string]catalog.ChannelMessage
}

// catalog turns the sites into channels. A site whose route cannot be
// followed to strings is a warning at the call, not a channel with a hole in
// it.
func (s *scanner) catalog(sites []site, b *plugin.Builder) []catalog.Channel {
	// What the tree declares of each exchange's type, then which queue is
	// bound where, before any publish or consume is placed.
	kinds := map[string]string{}
	declaredIn := map[string]string{}
	for _, found := range sites {
		if found.does != declare {
			continue
		}
		kind := s.literal(found)
		for _, name := range s.values(found.exchange, found.fn, 0) {
			if kind != "" && name.Value != "" {
				kinds[name.Value] = kind
				declaredIn[name.Value] = where(found.fn)
			}
		}
	}
	bindings := map[string][]binding{}
	for _, found := range sites {
		if found.does != bind {
			continue
		}
		queues := s.queueRefs(found.queue, found.fn)
		if len(queues) == 0 {
			b.Warn(found.at.String(), "queue of QueueBind could not be resolved to a literal, a constant, a config default or a caller's argument")
			continue
		}
		routes := s.routes(found.exchange, found.key, found.fn, 0, map[string]bool{})
		if len(routes) == 0 {
			b.Warn(found.at.String(), "exchange of QueueBind could not be resolved to a literal, a constant, a config default or a caller's argument")
			continue
		}
		for _, queue := range queues {
			for _, r := range routes {
				bindings[queue.key] = append(bindings[queue.key], binding{route: r, fn: where(found.fn)})
			}
		}
	}

	states := map[string]*channelState{}
	place := func(found site, r route, note string) bool {
		if r.keyless && kinds[r.exchange.Value] != "fanout" && kinds[r.exchange.Value] != "headers" {
			return false
		}
		addr, kind, title, ok := address(r.exchange.Value, r.key.Value, kinds)
		if !ok {
			return false
		}
		at := r.key.At
		if title == titleExchange {
			at = r.exchange.At
		}
		state := states[addr]
		if state == nil {
			state = &channelState{address: addr, kind: kind, title: title, pkgs: map[string]bool{}, exchanges: map[string]bool{}, notes: map[string]bool{}, messages: map[string]catalog.ChannelMessage{}}
			states[addr] = state
		}
		if kind == catalog.ChannelKindEvent {
			state.kind = kind
		}
		if rank[title] < rank[state.title] {
			state.title = title
		}
		if r.exchange.Value != "" {
			state.exchanges[r.exchange.Value] = true
		}
		state.pkgs[found.pkg] = true
		state.sources = append(state.sources, at.String())
		state.notes[note] = true
		direction := catalog.ChannelReceive
		if found.does == publish {
			direction = catalog.ChannelSend
		}
		if name := goscan.FirstNonEmpty(r.key.Name, r.exchange.Name); name != "" {
			state.messages[string(direction)+" "+name] = catalog.ChannelMessage{Name: name, Title: name, Direction: direction}
		}
		return true
	}

	for _, found := range sites {
		switch found.does {
		case publish:
			routes := s.routes(found.exchange, found.key, found.fn, 0, map[string]bool{})
			if len(routes) == 0 {
				b.Warn(found.at.String(), "exchange or routing key of "+found.method+" could not be resolved to a literal, a constant, a config default, a constructor's argument or a caller's argument")
				continue
			}
			for _, r := range routes {
				if place(found, r, publishNote(found, r, kinds)) {
					continue
				}
				if r.exchange.Value == "" {
					b.Warn(found.at.String(), found.method+" goes to the default exchange, and its routing key - the queue's name - could not be resolved or is empty")
				} else {
					b.Warn(found.at.String(), "routing key of "+found.method+" could not be resolved, and exchange `"+r.exchange.Value+"` is not declared fanout or headers in this tree")
				}
			}
		case consume:
			queues := s.queueRefs(found.queue, found.fn)
			if len(queues) == 0 {
				b.Warn(found.at.String(), "queue of "+found.method+" could not be resolved to a literal, a constant, a config default, a constructor's argument or a caller's argument")
				continue
			}
			for _, queue := range queues {
				bound := bindings[queue.key]
				if len(bound) == 0 {
					if queue.anonymous {
						b.Warn(found.at.String(), found.method+" reads a queue the server names, and nothing in this tree binds it to an exchange")
						continue
					}
					// Unbound, the queue is reached through the default
					// exchange, by its own name.
					unbound := route{key: goscan.Resolved{Value: queue.name, At: queue.at}}
					place(found, unbound, "Consumed by "+where(found.fn)+" from queue `"+queue.name+"`.")
					continue
				}
				for _, bd := range bound {
					if !place(found, bd.route, consumeNote(found, queue, bd)) {
						b.Warn(found.at.String(), "routing key of the QueueBind in "+bd.fn+" could not be resolved, and exchange `"+bd.route.exchange.Value+"` is not declared fanout or headers in this tree")
					}
				}
			}
		}
	}

	addresses := make([]string, 0, len(states))
	for addr := range states {
		addresses = append(addresses, addr)
	}
	sort.Strings(addresses)
	out := make([]catalog.Channel, 0, len(addresses))
	for _, addr := range addresses {
		state := states[addr]
		sort.Strings(state.sources)
		for exchange := range state.exchanges {
			if kind := kinds[exchange]; kind != "" {
				state.notes["Exchange `"+exchange+"` is declared `"+kind+"` in "+declaredIn[exchange]+"."] = true
			}
		}
		keys := make([]string, 0, len(state.messages))
		for key := range state.messages {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		messages := make([]catalog.ChannelMessage, 0, len(keys))
		for _, key := range keys {
			messages = append(messages, state.messages[key])
		}
		out = append(out, catalog.Channel{
			Address:  addr,
			Kind:     state.kind,
			Protocol: "amqp",
			Title:    state.title,
			Doc:      "Read through " + strings.Join(sorted(state.pkgs), " and ") + ". " + strings.Join(sorted(state.notes), " "),
			Messages: messages,
			Source:   state.sources[0],
		})
	}
	return out
}

// publishNote is one sentence on a publish: from where, to which exchange,
// with which key.
func publishNote(found site, r route, kinds map[string]string) string {
	text := "Published by " + where(found.fn)
	switch {
	case r.exchange.Value == "":
		return text + " straight to queue `" + r.key.Value + "` through the default exchange."
	case r.keyless || r.key.Value == "":
		return text + " to exchange `" + r.exchange.Value + "`."
	case kinds[r.exchange.Value] == "fanout" || kinds[r.exchange.Value] == "headers":
		return text + " to exchange `" + r.exchange.Value + "`, which does not route by the key `" + r.key.Value + "` it is given."
	}
	return text + " to exchange `" + r.exchange.Value + "` with routing key `" + r.key.Value + "`."
}

// consumeNote is one sentence on a consume through a binding: from where,
// which queue, bound how.
func consumeNote(found site, queue queueRef, bd binding) string {
	text := "Consumed by " + where(found.fn) + " from "
	if queue.anonymous {
		text += "a queue the server names"
	} else {
		text += "queue `" + queue.name + "`"
	}
	text += ", bound to exchange `" + bd.route.exchange.Value + "`"
	if !bd.route.keyless && bd.route.key.Value != "" {
		text += " with key `" + bd.route.key.Value + "`"
	}
	return text + " in " + bd.fn + "."
}

// where is a function as a sentence names it.
func where(fn *goscan.Function) string {
	if fn.Receiver == "" {
		return "`" + fn.Name + "`"
	}
	return "`" + goscan.LastSegment(fn.Receiver) + "." + fn.Name + "`"
}

// literal is the one string an ExchangeDeclare's type is worth, or empty.
func (s *scanner) literal(found site) string {
	values := s.values(found.kind, found.fn, 0)
	distinct := map[string]bool{}
	for _, value := range values {
		distinct[value.Value] = true
	}
	if len(distinct) != 1 {
		return ""
	}
	return values[0].Value
}

func sorted(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
