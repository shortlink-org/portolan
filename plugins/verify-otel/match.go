package main

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// lookup is the catalog, indexed for the questions a span raises: whose span
// is this, which operation answers on this route, which event travels under
// this name, who provides this rpc, where does this service keep its state.
type lookup struct {
	opts Options

	contexts   map[string]*catalog.BoundedContext
	services   map[string]*catalog.Service
	bySlug     map[string]*catalog.Service // unique slugs only
	events     map[string]*catalog.Event
	eventOwner map[string]*catalog.Service
	aggregate  map[string]*catalog.Aggregate // by event id
	byName     map[string][]string           // event name -> ids
	providers  map[string]*catalog.Service   // interface id -> provider
	rpcIDs     map[string]bool
	stores     map[string][]*catalog.Store // owner -> stores
	openings   map[string]*catalog.Flow    // opening key -> declared flow
}

func newLookup(cat *catalog.Catalog, opts Options) *lookup {
	l := &lookup{
		opts:       opts,
		contexts:   map[string]*catalog.BoundedContext{},
		services:   map[string]*catalog.Service{},
		bySlug:     map[string]*catalog.Service{},
		events:     map[string]*catalog.Event{},
		eventOwner: map[string]*catalog.Service{},
		aggregate:  map[string]*catalog.Aggregate{},
		byName:     map[string][]string{},
		providers:  map[string]*catalog.Service{},
		rpcIDs:     map[string]bool{},
		stores:     map[string][]*catalog.Store{},
		openings:   map[string]*catalog.Flow{},
	}

	slugs := map[string]int{}
	for i := range cat.Contexts {
		ctx := &cat.Contexts[i]
		l.contexts[ctx.ID] = ctx
		for j := range ctx.Services {
			svc := &ctx.Services[j]
			l.services[svc.ID] = svc
			slugs[svc.Slug]++
			l.bySlug[svc.Slug] = svc
			for k := range svc.Provides {
				provided := &svc.Provides[k]
				l.providers[provided.ID] = svc
				for _, method := range provided.Methods {
					l.rpcIDs[provided.ID+"/"+method.Name] = true
				}
			}
			for _, call := range svc.Consumes {
				l.rpcIDs[call.ID] = true
			}
			for k := range svc.Aggregates {
				agg := &svc.Aggregates[k]
				for m := range agg.Events {
					ev := &agg.Events[m]
					l.events[ev.ID] = ev
					l.eventOwner[ev.ID] = svc
					l.aggregate[ev.ID] = agg
					l.byName[ev.Name] = append(l.byName[ev.Name], ev.ID)
				}
			}
		}
	}
	for slug, n := range slugs {
		if n > 1 {
			delete(l.bySlug, slug)
		}
	}
	for i := range cat.Stores {
		store := &cat.Stores[i]
		l.stores[store.Owner] = append(l.stores[store.Owner], store)
	}
	for i := range cat.Flows {
		flow := &cat.Flows[i]
		if key := declaredOpening(flow); key != "" {
			if _, taken := l.openings[key]; !taken {
				l.openings[key] = flow
			}
		}
	}

	return l
}

// service reads a resource's service.name back to the catalog: the manifest's
// word first, then the one service whose slug it is.
func (l *lookup) service(name string) *catalog.Service {
	if id, ok := l.opts.Services[name]; ok {
		return l.services[id]
	}
	if svc, ok := l.services[name]; ok {
		return svc
	}

	return l.bySlug[name]
}

// operation reads a server span's route back to the operation the service's
// interface declares on it, by the verb and path template the OpenAPI
// extractor recorded.
func (l *lookup) operation(svc *catalog.Service, method, route string) (string, bool) {
	for _, provided := range svc.Provides {
		for _, m := range provided.Methods {
			if m.HTTP != nil && m.HTTP.Method == method && samePath(m.HTTP.Path, route) {
				return m.Name, true
			}
		}
	}

	return "", false
}

func samePath(a, b string) bool {
	return strings.TrimSuffix(a, "/") == strings.TrimSuffix(b, "/")
}

// event reads a wire name back to an event id. The manifest's word first;
// then, for a producer, the one event of its own with that name; then, for a
// consumer of somebody else's event, the one event anywhere with that name.
// Two events sharing a name is an ambiguity the manifest has to settle.
func (l *lookup) event(producer *catalog.Service, wire string) (string, bool) {
	if id, ok := l.opts.Events[wire]; ok {
		_, known := l.events[id]

		return id, known
	}
	name := wire
	if i := strings.LastIndex(wire, "."); i >= 0 {
		name = wire[i+1:]
	}

	candidates := l.byName[name]
	if producer != nil {
		var own []string
		for _, id := range candidates {
			if l.eventOwner[id] == producer {
				own = append(own, id)
			}
		}
		if len(own) == 1 {
			return own[0], true
		}
		if len(own) > 1 {
			return "", false
		}
	}
	if len(candidates) == 1 {
		return candidates[0], true
	}

	return "", false
}

// storeLane is where a service's database calls land: its one store, on the
// lane the code extractor names it by, or the service's own lane when it has
// none or several - saying so once beats inventing a database.
func (l *lookup) storeLane(svc *catalog.Service) (catalog.Participant, bool) {
	stores := l.stores[svc.ID]
	if len(stores) != 1 {
		return catalog.Participant{}, false
	}
	context := contextOf(svc.ID)

	return catalog.Participant{
		ID:      svc.Slug + "-" + stores[0].Slug,
		Kind:    catalog.ParticipantStore,
		Context: &context,
	}, true
}

func (l *lookup) serviceLane(svc *catalog.Service) catalog.Participant {
	context := contextOf(svc.ID)

	return catalog.Participant{ID: svc.ID, Kind: catalog.ParticipantService, Context: &context}
}

func contextOf(serviceID string) string {
	context, _, _ := strings.Cut(serviceID, ".")

	return context
}

// declaredOpening is the key a flow can be recognised by from its first step:
// the operation somebody calls in on, or the event that arrives. A flow that
// opens any other way - a store call, a self-message - is not one a trace can
// be matched to from its root, and gets no key.
func declaredOpening(flow *catalog.Flow) string {
	first := firstStep(flow.Steps)
	if first == nil {
		return ""
	}
	brokers := map[string]bool{}
	for _, p := range flow.Participants {
		if p.Kind == catalog.ParticipantBroker {
			brokers[p.ID] = true
		}
	}
	switch {
	case first.Kind == catalog.StepRPC && first.Ref == "" && first.From != first.To:
		return openingKey(catalog.StepRPC, first.To, first.Label)
	case first.Kind == catalog.StepEvent && first.Ref != "" && brokers[first.From]:
		return openingKey(catalog.StepEvent, first.To, first.Ref)
	}

	return ""
}

func openingKey(kind catalog.StepKind, service, what string) string {
	return string(kind) + "|" + service + "|" + what
}

func firstStep(nodes catalog.FlowNodes) *catalog.Step {
	for _, node := range nodes {
		switch x := node.(type) {
		case *catalog.Step:
			return x
		case *catalog.Parallel:
			for _, branch := range x.Branches {
				if s := firstStep(branch); s != nil {
					return s
				}
			}
		case *catalog.Alt:
			for _, branch := range x.Branches {
				if s := firstStep(branch.Steps); s != nil {
					return s
				}
			}
		case *catalog.Loop:
			if s := firstStep(x.Steps); s != nil {
				return s
			}
		}
	}

	return nil
}

// walkSteps visits every step, frames included, in flow order.
func walkSteps(nodes catalog.FlowNodes, visit func(*catalog.Step)) {
	for _, node := range nodes {
		switch x := node.(type) {
		case *catalog.Step:
			visit(x)
		case *catalog.Parallel:
			for _, branch := range x.Branches {
				walkSteps(branch, visit)
			}
		case *catalog.Alt:
			for _, branch := range x.Branches {
				walkSteps(branch.Steps, visit)
			}
		case *catalog.Loop:
			walkSteps(x.Steps, visit)
		}
	}
}
