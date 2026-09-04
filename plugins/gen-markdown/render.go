package main

import (
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// site is the whole render: the catalog, the place every entity's page will
// live, and the lookups that turn an id in the data into a link on a page.
//
// The layout is computed BEFORE anything is written. A page that mentions an
// aggregate has to know where the aggregate's page will be, and working that
// out at the moment of writing is how two pages end up disagreeing.
type site struct {
	cat  catalog.Catalog
	opts Options
	b    *builder

	// pathOf maps a catalog id to the file that documents it. An id absent
	// from this map belongs to another source, which is a fact worth saying
	// rather than a link worth guessing.
	pathOf map[string]string

	services  map[string]*catalog.Service
	contextOf map[string]*catalog.BoundedContext
	stores    map[string]*catalog.Store
	// eventPage maps an event id to the aggregate that publishes it, which is
	// the page that actually documents it.
	eventPage map[string]string
	// relationStore and relationName resolve a table or view id, which is what
	// foreign keys and lineage are written in, to the store that holds it and
	// the heading that documents it.
	relationStore map[string]string
	relationName  map[string]string
	// adrsFor is keyed by what an ADR is scoped to: "org", a context id, or a
	// service id.
	adrsFor map[string][]*catalog.Adr
	// methodOf is every interface method by "<interface>/<method>", which is
	// how a flow step names the call it makes.
	methodOf map[string]catalog.RpcMethod
}

func render(req plugin.Request, opts Options) plugin.Response {
	s := &site{
		cat:       req.Catalog,
		opts:      opts,
		b:         &builder{},
		pathOf:    map[string]string{},
		services:  map[string]*catalog.Service{},
		contextOf: map[string]*catalog.BoundedContext{},
		stores:    map[string]*catalog.Store{},
		eventPage: map[string]string{},
		adrsFor:   map[string][]*catalog.Adr{},
		methodOf:  map[string]catalog.RpcMethod{},

		relationStore: map[string]string{},
		relationName:  map[string]string{},
	}

	s.layout()
	s.renderIndex()
	s.renderTypes()
	for i := range s.cat.Contexts {
		s.renderContext(&s.cat.Contexts[i])
	}
	for i := range s.cat.Stores {
		s.renderStore(&s.cat.Stores[i])
	}
	s.renderFlows()
	s.renderAdrs()
	s.renderLlms()

	return s.b.Response()
}

// layout decides where everything goes and builds the lookups. Nothing is
// rendered here.
func (s *site) layout() {
	for i := range s.cat.Contexts {
		ctx := &s.cat.Contexts[i]
		s.pathOf[ctx.ID] = ctx.Slug + "/README.md"

		for j := range ctx.Services {
			svc := &ctx.Services[j]
			dir := ctx.Slug + "/" + svc.Slug
			s.pathOf[svc.ID] = dir + "/README.md"
			s.services[svc.ID] = svc
			for j := range svc.Provides {
				provided := &svc.Provides[j]
				for k := range provided.Methods {
					s.methodOf[provided.ID+"/"+provided.Methods[k].Name] = provided.Methods[k]
				}
			}
			s.contextOf[svc.ID] = ctx

			for k := range svc.Aggregates {
				agg := &svc.Aggregates[k]
				s.pathOf[agg.ID] = dir + "/aggregates/" + agg.Slug + ".md"

				for e := range agg.Events {
					s.eventPage[agg.Events[e].ID] = agg.ID
				}
			}
		}
	}

	for i := range s.cat.Stores {
		store := &s.cat.Stores[i]
		s.stores[store.ID] = store

		for j := range store.Tables {
			s.relationStore[store.Tables[j].ID] = store.ID
			s.relationName[store.Tables[j].ID] = store.Tables[j].Name
		}
		for j := range store.Views {
			s.relationStore[store.Views[j].ID] = store.ID
			s.relationName[store.Views[j].ID] = store.Views[j].Name
		}

		// A store lives under the service that owns it. When the owner is in
		// another source there is no such directory, so it sits at the root
		// and the service page that would have linked it says why.
		if ownerPath, ok := s.pathOf[store.Owner]; ok {
			s.pathOf[store.ID] = parent(ownerPath) + "/stores/" + store.Slug + ".md"
		} else {
			s.pathOf[store.ID] = "stores/" + store.ID + ".md"
			s.b.warn(store.ID, "store %q is owned by %q, which is not in this catalog; its page sits at the root", store.ID, store.Owner)
		}
	}

	for i := range s.cat.Flows {
		s.pathOf[s.cat.Flows[i].ID] = "flows/" + s.cat.Flows[i].Slug + ".md"
	}

	for i := range s.cat.Adrs {
		adr := &s.cat.Adrs[i]
		s.pathOf[adr.ID] = "adr/" + adr.ID + ".md"

		switch adr.Scope.Kind {
		case "context":
			s.adrsFor[adr.Scope.Context] = append(s.adrsFor[adr.Scope.Context], adr)
		case "service":
			s.adrsFor[adr.Scope.Service] = append(s.adrsFor[adr.Scope.Service], adr)
		default:
			s.adrsFor["org"] = append(s.adrsFor["org"], adr)
		}
	}
}

// ref renders a link to another page, or plain code when the target is not in
// this catalog. The second case is the normal one for a merged estate: an
// event consumer, an rpc peer or a store owner routinely lives in a source
// this render never saw.
func (s *site) ref(from, id, text string) string {
	if text == "" {
		text = id
	}
	if to, ok := s.pathOf[id]; ok {
		return link(text, from, to)
	}

	return code(text)
}

func (s *site) renderIndex() {
	const self = "README.md"

	var b strings.Builder
	b.WriteString("# " + s.title() + "\n\n")
	b.WriteString(s.stamp() + "\n")

	rows := make([][]string, 0, len(s.cat.Contexts))
	for i := range s.cat.Contexts {
		ctx := &s.cat.Contexts[i]
		names := make([]string, 0, len(ctx.Services))
		for j := range ctx.Services {
			names = append(names, s.ref(self, ctx.Services[j].ID, ctx.Services[j].Name))
		}
		rows = append(rows, []string{
			s.ref(self, ctx.ID, ctx.Name),
			string(ctx.Classification),
			strings.Join(names, ", "),
			firstLine(ctx.Summary),
		})
	}
	section(&b, "Contexts", table([]string{"Context", "Class", "Services", "Summary"}, rows))

	flows := make([][]string, 0, len(s.cat.Flows))
	for i := range s.cat.Flows {
		flow := &s.cat.Flows[i]
		owner := "—"
		if flow.Owner != "" {
			owner = s.ref(self, flow.Owner, flow.Owner)
		}
		flows = append(flows, []string{
			s.ref(self, flow.ID, flow.Name),
			owner,
			firstLine(flow.Summary),
		})
	}
	section(&b, "Flows", table([]string{"Flow", "Owner", "Summary"}, flows))

	adrs := make([][]string, 0, len(s.cat.Adrs))
	for i := range s.cat.Adrs {
		adr := &s.cat.Adrs[i]
		adrs = append(adrs, []string{
			s.ref(self, adr.ID, adr.ID),
			adr.Title,
			string(adr.Status),
			adr.Date,
		})
	}
	section(&b, "Decisions", table([]string{"ADR", "Title", "Status", "Date"}, adrs))

	s.b.file(self, b.String())
}

func (s *site) title() string {
	if s.opts.Title != "" {
		return s.opts.Title
	}

	return "Architecture catalog"
}

// stamp is the provenance line every page carries. A generated page that does
// not say what it was generated from is indistinguishable from a hand-written
// one that has gone stale.
func (s *site) stamp() string {
	parts := []string{"Generated from the portolan catalog"}
	if s.cat.Commit != "" {
		parts = append(parts, "commit "+code(s.cat.Commit))
	}
	if s.cat.GeneratedAt != "" {
		parts = append(parts, "at "+s.cat.GeneratedAt)
	}

	return "*" + strings.Join(parts, " · ") + ". Do not edit by hand.*\n"
}

func firstLine(s string) string {
	if i := strings.Index(s, "\n"); i >= 0 {
		return strings.TrimSpace(s[:i])
	}

	return strings.TrimSpace(s)
}

// parent is the directory a page sits in, as a slash path.
func parent(page string) string {
	if i := strings.LastIndex(page, "/"); i >= 0 {
		return page[:i]
	}

	return "."
}

func sortedDefKeys(defs map[string]catalog.TypeDef) []string {
	keys := make([]string, 0, len(defs))
	for k := range defs {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	return keys
}
