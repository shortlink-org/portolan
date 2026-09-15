package extractdebezium

import (
	"fmt"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
)

func (e *estate) service(id string) *serviceState {
	context, slug := serviceParts(id)
	group := e.groups[context]
	if group == nil {
		group = &groupState{services: map[string]*serviceState{}}
		e.groups[context] = group
	}
	state := group.services[id]
	if state == nil {
		state = &serviceState{
			service:  catalog.Service{ID: id, Slug: slug, Provides: []catalog.RpcService{}, Consumes: []catalog.RpcCall{}, Aggregates: []catalog.Aggregate{}},
			channels: map[string]*channelState{},
			stores:   map[string]bool{},
		}
		group.services[id] = state
	}
	return state
}

func serviceParts(id string) (string, string) {
	if at := strings.LastIndex(id, "."); at > 0 && at < len(id)-1 {
		return id[:at], id[at+1:]
	}
	return id, goscan.Slug(id)
}

func (s *serviceState) channel(address string, kind catalog.ChannelKind, source, doc string) *channelState {
	state := s.channels[address]
	if state == nil {
		state = &channelState{channel: catalog.Channel{Address: address, Kind: kind, Title: "Kafka topic", Doc: doc, Messages: []catalog.ChannelMessage{}, Source: source}, messages: map[string]catalog.ChannelMessage{}}
		s.channels[address] = state
	}
	return state
}

func (c *channelState) add(message catalog.ChannelMessage) {
	key := string(message.Direction) + "\x00" + message.Name
	if _, held := c.messages[key]; !held {
		c.messages[key] = message
	}
}

func (e *estate) flow(found connector, opts ConnectorOptions, connectorID, table, topic, message string, outbox bool) catalog.Flow {
	connectorContext, _ := serviceParts(connectorID)
	storeLane := goscan.Slug(found.name) + "-source"
	storeContext := connectorContext
	storeParticipant := catalog.Participant{ID: storeLane, Kind: catalog.ParticipantStore, Context: &storeContext, Label: table}
	if opts.Store != "" {
		storeParticipant.EntityRef = opts.Store
		if opts.SourceService != "" {
			storeContext, _ = serviceParts(opts.SourceService)
			storeParticipant.Context = &storeContext
		}
	}
	brokerLane := goscan.Slug(found.name) + "-kafka"
	participants := []catalog.Participant{
		storeParticipant,
		{ID: connectorID, Kind: catalog.ParticipantService, Context: &connectorContext, EntityRef: connectorID},
		{ID: brokerLane, Kind: catalog.ParticipantBroker, Label: "Kafka"},
	}

	note := "The connector configuration declares this table in table.include.list."
	if outbox {
		note = "The connector captures the outbox table; the Event Router turns its INSERT rows into messages."
	}
	steps := catalog.FlowNodes{&catalog.Step{
		Type: "step", ID: "capture", From: storeLane, To: connectorID, Kind: catalog.StepCall,
		Label: "capture " + table, Status: catalog.StatusDeclared, Note: note, Line: found.where,
		Evidence: []catalog.RelationEvidence{{Kind: "configuration", Rule: "debezium-table-include", Source: found.where, Symbol: table}},
	}}
	if topic != "" {
		steps = append(steps, &catalog.Step{
			Type: "step", ID: "publish", From: connectorID, To: brokerLane, Kind: catalog.StepEvent,
			Label: "publish " + goscan.FirstNonEmpty(message, topic), Status: catalog.StatusDeclared, Line: found.where,
			Handoff:  &catalog.FlowHandoff{Kind: "message", Transport: e.broker, Channel: topic, Message: message, Direction: "send"},
			Evidence: []catalog.RelationEvidence{{Kind: "configuration", Rule: routingRule(outbox), Source: found.where, Symbol: topic}},
		})
	}

	mode := "CDC"
	if outbox {
		mode = "outbox"
	}
	name := found.name + " · " + table + " · " + mode
	if outbox && message != "" {
		name = found.name + " · " + message
	}
	identity := strings.Join([]string{found.name, table, topic, message}, "-")
	slug := goscan.Slug(identity)
	return catalog.Flow{
		ID:           connectorID + "." + slug,
		Slug:         slug,
		Name:         name,
		Summary:      fmt.Sprintf("Debezium captures %s and relays it to Kafka from the connector configuration.", table),
		Source:       found.where,
		Trigger:      &catalog.FlowTrigger{Kind: "startup", Label: "Kafka Connect task", Confidence: "high"},
		Owner:        connectorContext,
		Participants: participants,
		Steps:        steps,
	}
}

func routingRule(outbox bool) string {
	if outbox {
		return "debezium-outbox-event-router"
	}
	return "debezium-default-topic"
}

func (e *estate) addFlow(flow catalog.Flow) {
	if e.flowIDs[flow.ID] {
		return
	}
	e.flowIDs[flow.ID] = true
	e.flows = append(e.flows, flow)
}

func (e *estate) catalog() catalog.Catalog {
	contextIDs := make([]string, 0, len(e.groups))
	for id := range e.groups {
		contextIDs = append(contextIDs, id)
	}
	sort.Strings(contextIDs)

	contexts := make([]catalog.BoundedContext, 0, len(contextIDs))
	for _, contextID := range contextIDs {
		group := e.groups[contextID]
		serviceIDs := make([]string, 0, len(group.services))
		for id := range group.services {
			serviceIDs = append(serviceIDs, id)
		}
		sort.Strings(serviceIDs)
		services := make([]catalog.Service, 0, len(serviceIDs))
		for _, id := range serviceIDs {
			state := group.services[id]
			addresses := make([]string, 0, len(state.channels))
			for address := range state.channels {
				addresses = append(addresses, address)
			}
			sort.Strings(addresses)
			for _, address := range addresses {
				channel := state.channels[address]
				keys := make([]string, 0, len(channel.messages))
				for key := range channel.messages {
					keys = append(keys, key)
				}
				sort.Strings(keys)
				for _, key := range keys {
					channel.channel.Messages = append(channel.channel.Messages, channel.messages[key])
				}
				state.service.Channels = append(state.service.Channels, channel.channel)
			}
			for store := range state.stores {
				state.service.Stores = append(state.service.Stores, store)
			}
			sort.Strings(state.service.Stores)
			services = append(services, state.service)
		}
		contexts = append(contexts, catalog.BoundedContext{ID: contextID, Slug: contextID, Services: services})
	}

	sort.Slice(e.flows, func(i, j int) bool { return e.flows[i].ID < e.flows[j].ID })
	return catalog.Catalog{Contexts: contexts, Defs: map[string]catalog.TypeDef{}, Flows: e.flows, Stores: []catalog.Store{}, Adrs: []catalog.Adr{}}
}
