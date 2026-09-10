package extractgonats

import (
	"encoding/json"
	"go/ast"
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
	s.index()

	sites := s.sites()
	if len(sites) == 0 {
		b.Warn(in.Root, "no nats.go or JetStream call was found")
	}
	channels := s.catalog(sites, b)

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
	b.File(goscan.FirstNonEmpty(opts.Out, "nats.json"), string(encoded)+"\n")
	return b.Response(), nil
}

// channelState is one subject as the sites describe it, gathered before it
// is written out: which way messages go from where, and what they are
// called when a port said.
type channelState struct {
	address  string
	api      string
	sources  []string
	notes    map[string]bool
	messages map[string]catalog.ChannelMessage
}

// catalog turns the sites into channels. A site whose subject cannot be
// followed to a string is a warning at the call, not a channel with a hole
// in it.
func (s *scanner) catalog(sites []site, b *plugin.Builder) []catalog.Channel {
	states := map[string]*channelState{}
	for _, found := range sites {
		if len(found.subjects) == 0 {
			why := "the message was not built with nats.NewMsg or &nats.Msg{Subject: ...} in this function"
			if found.configured {
				why = "a consumer with no filter subject reads whatever its stream holds"
			}
			b.Warn(found.at.String(), found.method+" names no subject this reader can see: "+why)
			continue
		}
		for _, subject := range found.subjects {
			values := s.resolve(subject, found.fn, 0, map[string]bool{})
			if len(values) == 0 {
				b.Warn(found.at.String(), "subject of "+found.method+" could not be resolved to a literal, a constant, a config default or a caller's argument")
				continue
			}
			for _, value := range values {
				state := states[value.value]
				if state == nil {
					state = &channelState{address: value.value, api: found.api, notes: map[string]bool{}, messages: map[string]catalog.ChannelMessage{}}
					states[value.value] = state
				}
				state.sources = append(state.sources, value.at.String())
				state.notes[s.note(found)] = true
				if value.name != "" {
					state.messages[string(found.direction)+" "+value.name] = catalog.ChannelMessage{Name: value.name, Title: value.name, Direction: found.direction}
				}
			}
		}
	}

	addresses := make([]string, 0, len(states))
	for address := range states {
		addresses = append(addresses, address)
	}
	sort.Strings(addresses)
	out := make([]catalog.Channel, 0, len(addresses))
	for _, address := range addresses {
		state := states[address]
		sort.Strings(state.sources)
		notes := make([]string, 0, len(state.notes))
		for note := range state.notes {
			notes = append(notes, note)
		}
		sort.Strings(notes)
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
			Address:  address,
			Kind:     catalog.ChannelKindEvent,
			Title:    state.api + " subject",
			Doc:      "Read through " + natsPkg + ". " + strings.Join(notes, " "),
			Messages: messages,
			Source:   state.sources[0],
		})
	}
	return out
}

// note is one sentence on a site: which way, from where, and what JetStream
// was told about the consumer.
func (s *scanner) note(found site) string {
	verb := "Subscribed"
	if found.direction == catalog.ChannelSend {
		verb = "Published"
	}
	text := verb + " by `" + goscan.LastSegment(found.fn.receiver) + dot(found.fn.receiver) + found.fn.name + "`"
	if found.api == "JetStream" {
		text += " over JetStream"
	}
	if durable := s.literal(found.durable, found.fn); durable != "" {
		text += ", durable consumer `" + durable + "`"
	}
	if queue := s.literal(found.queue, found.fn); queue != "" {
		text += ", queue group `" + queue + "`"
	}
	return text + "."
}

func dot(receiver string) string {
	if receiver == "" {
		return ""
	}
	return "."
}

// literal is a string an expression is worth without leaving the function:
// a durable name or queue group is documentation, and following it up the
// callers would be more than it is worth.
func (s *scanner) literal(expr ast.Expr, fn *function) string {
	if expr == nil {
		return ""
	}
	values := s.resolve(expr, fn, hops, map[string]bool{})
	if len(values) != 1 {
		return ""
	}
	return values[0].value
}
