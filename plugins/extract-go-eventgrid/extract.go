package extractgoeventgrid

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
		b.Warn(in.Root, "no Azure Event Grid publisher call was found")
	}
	channels := s.catalog(sites, b)
	serviceID := opts.Context + "." + opts.Service
	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID: opts.Context, Slug: opts.Context,
			Services: []catalog.Service{{
				ID: serviceID, Slug: opts.Service,
				Provides: []catalog.RpcService{}, Consumes: []catalog.RpcCall{}, Aggregates: []catalog.Aggregate{}, Channels: channels,
			}},
		}},
		Defs: map[string]catalog.TypeDef{}, Flows: []catalog.Flow{}, Adrs: []catalog.Adr{},
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(goscan.FirstNonEmpty(opts.Out, "eventgrid.json"), string(encoded)+"\n")
	return b.Response(), nil
}

type channelState struct {
	config   clientConfig
	sources  []string
	notes    map[string]bool
	messages map[string]catalog.ChannelMessage
}

func (s *scanner) catalog(sites []site, b *plugin.Builder) []catalog.Channel {
	states := map[string]*channelState{}
	for _, found := range sites {
		configs := s.clientConfigs(found.client, found.fn)
		if len(configs) == 0 {
			b.Warn(found.at.String(), "topic of "+found.method+" could not be resolved from the Event Grid client constructor")
			continue
		}
		messages := s.eventTypes(found.events, found.fn)
		for _, config := range configs {
			state := states[config.address]
			if state == nil {
				state = &channelState{config: config, notes: map[string]bool{}, messages: map[string]catalog.ChannelMessage{}}
				states[config.address] = state
			}
			state.sources = append(state.sources, found.at.String())
			state.notes[publishNote(found)] = true
			for _, name := range messages {
				state.messages[name] = catalog.ChannelMessage{Name: name, Title: name, Direction: catalog.ChannelSend}
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
		notes := sortedKeys(state.notes)
		messageNames := make([]string, 0, len(state.messages))
		for name := range state.messages {
			messageNames = append(messageNames, name)
		}
		sort.Strings(messageNames)
		messages := make([]catalog.ChannelMessage, 0, len(messageNames))
		for _, name := range messageNames {
			messages = append(messages, state.messages[name])
		}
		out = append(out, catalog.Channel{
			Address: address, Kind: catalog.ChannelKindEvent, Title: state.config.title,
			Doc:      "Published through " + state.config.packageName + ". " + strings.Join(notes, " "),
			Messages: messages, Source: state.sources[0],
		})
	}
	return out
}

func publishNote(found site) string {
	verb := "Published"
	if found.batch {
		verb = "Published in batches"
	}
	return verb + " as " + found.schema + " by `" + goscan.LastSegment(found.fn.Receiver) + dot(found.fn.Receiver) + found.fn.Name + "`."
}

func sortedKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func dot(receiver string) string {
	if receiver == "" {
		return ""
	}
	return "."
}
