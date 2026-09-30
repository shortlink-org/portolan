package extractgokafka

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

	sites := s.sites()
	if len(sites) == 0 {
		b.Warn(in.Root, "no sarama, kafka-go, confluent-kafka-go or franz-go topic was found")
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
	b.File(goscan.FirstNonEmpty(opts.Out, "kafka.json"), string(encoded)+"\n")
	return b.Response(), nil
}

// channelState is one topic as the sites describe it, gathered before it is
// written out: which way messages go from where, through which client, and
// what they are called when a port said.
type channelState struct {
	address  string
	pkgs     map[string]bool
	sources  []string
	notes    map[string]bool
	messages map[string]catalog.ChannelMessage
}

// catalog turns the sites into channels. A site whose topic cannot be
// followed to a string is a warning at the site, not a channel with a hole
// in it.
func (s *scanner) catalog(sites []site, b *plugin.Builder) []catalog.Channel {
	states := map[string]*channelState{}
	for _, found := range sites {
		if found.hidden {
			b.Warn(found.at.String(), found.what+" names no topic this reader can see: its TopicPartition was not written as kafka.TopicPartition{Topic: ...} in this function")
		}
		if found.unlisted {
			b.Warn(found.at.String(), "topics of "+found.what+" could not be followed to a list of literals, constants, config defaults or callers' arguments")
		}
		for _, ref := range found.topics {
			values := s.values(ref)
			if len(values) == 0 {
				b.Warn(s.At(ref.expr.Pos()).String(), "topic of "+found.what+" could not be resolved to a literal, a constant, a config default, a constructor's argument or a caller's argument")
				continue
			}
			for _, value := range values {
				if value.Value == "" {
					b.Warn(value.At.String(), "topic of "+found.what+" is empty")
					continue
				}
				state := states[value.Value]
				if state == nil {
					state = &channelState{address: value.Value, pkgs: map[string]bool{}, notes: map[string]bool{}, messages: map[string]catalog.ChannelMessage{}}
					states[value.Value] = state
				}
				state.pkgs[found.pkg] = true
				state.sources = append(state.sources, value.At.String())
				state.notes[s.note(found)] = true
				if value.Name != "" {
					state.messages[string(found.direction)+" "+value.Name] = catalog.ChannelMessage{Name: value.Name, Title: value.Name, Direction: found.direction}
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
			Protocol: "kafka",
			Title:    "Kafka topic",
			Doc:      "Read through " + strings.Join(sorted(state.pkgs), " and ") + ". " + strings.Join(sorted(state.notes), " "),
			Messages: messages,
			Source:   state.sources[0],
		})
	}
	return out
}

func sorted(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

// note is one sentence on a site: which way, from where, through which
// client, and the consumer group when the code names one.
func (s *scanner) note(found site) string {
	where := "`" + goscan.LastSegment(found.fn.Receiver) + dot(found.fn.Receiver) + found.fn.Name + "`"
	lib := library[found.pkg]
	var text string
	switch found.role {
	case roleWriter:
		text = "Produced by the " + lib + " writer built in " + where
	case roleReader:
		text = "Consumed by the " + lib + " reader built in " + where
	default:
		verb := "Consumed"
		if found.direction == catalog.ChannelSend {
			verb = "Produced"
		}
		text = verb + " by " + where + " through " + lib
	}
	if found.partition {
		text += ", partition by partition with no consumer group"
	}
	if group := s.literal(found.group, found.groupFn); group != "" {
		text += ", consumer group `" + group + "`"
	}
	return text + "."
}

func dot(receiver string) string {
	if receiver == "" {
		return ""
	}
	return "."
}

// literal is the one string an expression is worth, or empty: a consumer
// group is documentation, and two candidates are not one.
func (s *scanner) literal(expr ast.Expr, fn *goscan.Function) string {
	if expr == nil || fn == nil {
		return ""
	}
	values := s.Resolve(expr, fn, 0, map[string]bool{})
	distinct := map[string]bool{}
	for _, value := range values {
		distinct[value.Value] = true
	}
	if len(distinct) != 1 {
		return ""
	}
	return values[0].Value
}
