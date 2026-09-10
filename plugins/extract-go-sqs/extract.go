package extractgosqs

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
		b.Warn(in.Root, "no aws-sdk-go-v2 SQS call was found")
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
	b.File(goscan.FirstNonEmpty(opts.Out, "sqs.json"), string(encoded)+"\n")
	return b.Response(), nil
}

// channelState is one queue as the sites describe it, gathered before it is
// written out: which way messages go from where, and what they are called
// when a port said.
type channelState struct {
	address  string
	sources  []string
	notes    map[string]bool
	messages map[string]catalog.ChannelMessage
}

// catalog turns the sites into channels. A site whose queue cannot be
// followed to a string is a warning at the call, not a channel with a hole
// in it.
func (s *scanner) catalog(sites []site, b *plugin.Builder) []catalog.Channel {
	states := map[string]*channelState{}
	for _, found := range sites {
		if found.queue == nil {
			b.Warn(found.at.String(), found.method+" names no queue this reader can see: the input was not written as &sqs."+found.method+"Input{QueueUrl: ...} in this function")
			continue
		}
		values := s.values(found.queue, found.fn)
		if len(values) == 0 {
			b.Warn(found.at.String(), "queue of "+found.method+" could not be resolved to a literal, a constant, a config default, a constructor's argument or a caller's argument")
			continue
		}
		for _, value := range values {
			address := queueName(value.Value)
			state := states[address]
			if state == nil {
				state = &channelState{address: address, notes: map[string]bool{}, messages: map[string]catalog.ChannelMessage{}}
				states[address] = state
			}
			state.sources = append(state.sources, value.At.String())
			state.notes[note(found)] = true
			if value.Name != "" {
				state.messages[string(found.direction)+" "+value.Name] = catalog.ChannelMessage{Name: value.Name, Title: value.Name, Direction: found.direction}
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
			Kind:     catalog.ChannelKindMessage,
			Title:    "SQS queue",
			Doc:      "Read through " + sqsPkg + ". " + strings.Join(notes, " "),
			Messages: messages,
			Source:   state.sources[0],
		})
	}
	return out
}

// note is one sentence on a site: which way and from where.
func note(found site) string {
	verb := "Received"
	if found.direction == catalog.ChannelSend {
		verb = "Sent"
		if found.batch {
			verb = "Sent in batches"
		}
	}
	return verb + " by `" + goscan.LastSegment(found.fn.Receiver) + dot(found.fn.Receiver) + found.fn.Name + "`."
}

func dot(receiver string) string {
	if receiver == "" {
		return ""
	}
	return "."
}
