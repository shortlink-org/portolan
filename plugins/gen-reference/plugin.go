package genreference

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"slices"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

const outputName = "architecture.html"

type Options struct {
	Title   string `json:"title,omitempty"`
	Summary string `json:"summary,omitempty"`
}

type reference struct {
	Title     string     `json:"title"`
	Summary   string     `json:"summary,omitempty"`
	Counts    []count    `json:"counts"`
	Resources []resource `json:"resources"`
	Catalog   any        `json:"catalog"`
}

type count struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Value int    `json:"value"`
}

type resource struct {
	Kind          string         `json:"kind"`
	KindLabel     string         `json:"kindLabel"`
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Summary       string         `json:"summary,omitempty"`
	Parent        string         `json:"parent,omitempty"`
	Badges        []string       `json:"badges,omitempty"`
	Relationships []relationship `json:"relationships,omitempty"`
	Record        any            `json:"record"`
}

type relationship struct {
	Label string `json:"label"`
	ID    string `json:"id"`
}

func render(req plugin.Request, opts Options) (plugin.Response, error) {
	model := buildReference(canonicalCatalog(req.Catalog), opts)
	payload, err := json.Marshal(model)
	if err != nil {
		return plugin.Response{}, fmt.Errorf("marshal architecture reference: %w", err)
	}

	var page bytes.Buffer
	if err := referenceTemplate.Execute(&page, struct {
		Title   string
		Payload template.JS
	}{Title: model.Title, Payload: template.JS(payload)}); err != nil {
		return plugin.Response{}, fmt.Errorf("render architecture reference: %w", err)
	}

	b := &plugin.Builder{}
	b.File(outputName, page.String())
	return b.Response(), nil
}

func buildReference(cat catalog.Catalog, opts Options) reference {
	title := strings.TrimSpace(opts.Title)
	if title == "" {
		title = "Architecture reference"
	}

	resources := make([]resource, 0)
	storesByService := map[string][]string{}
	modulesByService := map[string][]string{}

	for _, store := range cat.Stores {
		storesByService[store.Owner] = append(storesByService[store.Owner], store.ID)
	}
	for _, module := range cat.Modules {
		modulesByService[module.Owner] = append(modulesByService[module.Owner], module.ID)
	}
	for _, ctx := range cat.Contexts {
		rels := make([]relationship, 0, len(ctx.Services))
		for _, service := range ctx.Services {
			rels = append(rels, relationship{Label: "contains", ID: service.ID})
		}
		resources = append(resources, resource{
			Kind: "context", KindLabel: groupLabel(ctx.Kind), ID: ctx.ID, Name: ctx.Name,
			Summary: ctx.Summary, Badges: compact(string(ctx.Classification), string(ctx.Kind)), Relationships: rels, Record: ctx,
		})

		for _, service := range ctx.Services {
			rels := []relationship{{Label: "in", ID: ctx.ID}}
			for _, dependency := range service.DependsOn {
				rels = append(rels, relationship{Label: "depends on", ID: dependency})
			}
			for _, call := range service.Consumes {
				if call.Peer != "" {
					rels = append(rels, relationship{Label: "calls", ID: call.Peer})
				}
			}
			for _, aggregate := range service.Aggregates {
				rels = append(rels, relationship{Label: "owns", ID: aggregate.ID})
			}
			for _, id := range storesByService[service.ID] {
				rels = append(rels, relationship{Label: "owns store", ID: id})
			}
			for _, id := range modulesByService[service.ID] {
				rels = append(rels, relationship{Label: "publishes module", ID: id})
			}
			resources = append(resources, resource{
				Kind: "service", KindLabel: componentLabel(service.Kind), ID: service.ID, Name: service.Name,
				Summary: lede(service.Readme), Parent: ctx.ID, Badges: append(compact(string(service.Kind)), service.Technologies...),
				Relationships: uniqueRelationships(rels), Record: service,
			})

			for _, aggregate := range service.Aggregates {
				aggRels := []relationship{{Label: "owned by", ID: service.ID}}
				for _, event := range aggregate.Events {
					aggRels = append(aggRels, relationship{Label: "publishes", ID: event.ID})
				}
				resources = append(resources, resource{
					Kind: "aggregate", KindLabel: "aggregate", ID: aggregate.ID, Name: aggregate.Name,
					Summary: lede(aggregate.Readme), Parent: service.ID, Relationships: aggRels, Record: aggregate,
				})
				for _, event := range aggregate.Events {
					eventRels := []relationship{{Label: "published by", ID: aggregate.ID}}
					for _, consumer := range event.Consumers {
						eventRels = append(eventRels, relationship{Label: "consumed by", ID: consumer.Service})
					}
					resources = append(resources, resource{
						Kind: "event", KindLabel: "event", ID: event.ID, Name: event.Name, Parent: aggregate.ID,
						Badges: eventBadges(event), Relationships: eventRels, Record: event,
					})
				}
			}
		}
	}

	for _, store := range cat.Stores {
		rels := []relationship{{Label: "owned by", ID: store.Owner}}
		for _, ctx := range cat.Contexts {
			for _, service := range ctx.Services {
				if slices.Contains(service.Stores, store.ID) && service.ID != store.Owner {
					rels = append(rels, relationship{Label: "read by", ID: service.ID})
				}
			}
		}
		resources = append(resources, resource{Kind: "store", KindLabel: "data store", ID: store.ID, Name: store.Name,
			Parent: store.Owner, Badges: compact(string(store.Kind)), Relationships: rels, Record: store})
	}

	for _, flow := range cat.Flows {
		rels := make([]relationship, 0, len(flow.Participants)+1)
		if flow.Owner != "" {
			rels = append(rels, relationship{Label: "owned by", ID: flow.Owner})
		}
		for _, participant := range flow.Participants {
			if participant.Kind != catalog.ParticipantActor {
				rels = append(rels, relationship{Label: "touches", ID: participant.ID})
			}
		}
		resources = append(resources, resource{Kind: "flow", KindLabel: "flow", ID: flow.ID, Name: flow.Name,
			Summary: flow.Summary, Parent: flow.Owner, Relationships: uniqueRelationships(rels), Record: flow})
	}

	for _, ext := range cat.Externals {
		resources = append(resources, resource{Kind: "external", KindLabel: "external", ID: ext.ID, Name: ext.Name,
			Summary: ext.Summary, Record: ext})
	}
	for _, module := range cat.Modules {
		resources = append(resources, resource{Kind: "module", KindLabel: "schema module", ID: module.ID, Name: module.Name,
			Parent: module.Owner, Relationships: []relationship{{Label: "published by", ID: module.Owner}}, Record: module})
	}
	for _, adr := range cat.Adrs {
		resources = append(resources, resource{Kind: "adr", KindLabel: "decision", ID: adr.ID, Name: adr.Title,
			Summary: lede(adr.Body), Badges: compact(string(adr.Status)), Record: adr})
	}
	for _, rfc := range cat.Rfcs {
		resources = append(resources, resource{Kind: "rfc", KindLabel: "RFC", ID: rfc.ID, Name: rfc.Title,
			Summary: lede(rfc.Body), Badges: compact(rfc.Status), Record: rfc})
	}
	for _, spec := range cat.Specs {
		resources = append(resources, resource{Kind: "spec", KindLabel: "change spec", ID: spec.ID, Name: spec.Title,
			Badges: compact(spec.Format, spec.Lifecycle), Record: spec})
	}

	slices.SortFunc(resources, func(a, b resource) int {
		if kindOrder(a.Kind) != kindOrder(b.Kind) {
			return kindOrder(a.Kind) - kindOrder(b.Kind)
		}
		return strings.Compare(a.ID, b.ID)
	})

	counts := []count{
		{Kind: "context", Label: "groups", Value: len(cat.Contexts)},
		{Kind: "service", Label: "components", Value: countServices(cat)},
		{Kind: "flow", Label: "flows", Value: len(cat.Flows)},
		{Kind: "store", Label: "data stores", Value: len(cat.Stores)},
		{Kind: "adr", Label: "decisions", Value: len(cat.Adrs)},
	}

	return reference{Title: title, Summary: strings.TrimSpace(opts.Summary), Counts: counts, Resources: resources, Catalog: cat}
}

func canonicalCatalog(cat catalog.Catalog) catalog.Catalog {
	out := cat
	out.Contexts = slices.Clone(cat.Contexts)
	slices.SortFunc(out.Contexts, func(a, b catalog.BoundedContext) int { return strings.Compare(a.ID, b.ID) })
	for i := range out.Contexts {
		out.Contexts[i].Services = slices.Clone(out.Contexts[i].Services)
		slices.SortFunc(out.Contexts[i].Services, func(a, b catalog.Service) int { return strings.Compare(a.ID, b.ID) })
		for j := range out.Contexts[i].Services {
			svc := &out.Contexts[i].Services[j]
			svc.Aggregates = slices.Clone(svc.Aggregates)
			slices.SortFunc(svc.Aggregates, func(a, b catalog.Aggregate) int { return strings.Compare(a.ID, b.ID) })
			for k := range svc.Aggregates {
				agg := &svc.Aggregates[k]
				agg.Events = slices.Clone(agg.Events)
				slices.SortFunc(agg.Events, func(a, b catalog.Event) int { return strings.Compare(a.ID, b.ID) })
			}
			svc.DependsOn = sortedStrings(svc.DependsOn)
			svc.Stores = sortedStrings(svc.Stores)
			svc.Modules = sortedStrings(svc.Modules)
		}
	}
	out.Stores = sortedBy(out.Stores, func(v catalog.Store) string { return v.ID })
	out.Flows = sortedBy(out.Flows, func(v catalog.Flow) string { return v.ID })
	out.Adrs = sortedBy(out.Adrs, func(v catalog.Adr) string { return v.ID })
	out.Rfcs = sortedBy(out.Rfcs, func(v catalog.Rfc) string { return v.ID })
	out.Specs = sortedBy(out.Specs, func(v catalog.ChangeSpec) string { return v.ID })
	out.Modules = sortedBy(out.Modules, func(v catalog.ProtoModule) string { return v.ID })
	out.Externals = sortedBy(out.Externals, func(v catalog.External) string { return v.ID })
	out.Terms = sortedBy(out.Terms, func(v catalog.Term) string { return v.Context + "\x00" + strings.ToLower(v.Name) })
	out.Repos = sortedBy(out.Repos, func(v catalog.RepoPin) string { return v.Repo })
	out.Deployments = sortedBy(out.Deployments, func(v catalog.Deployment) string { return v.ID })
	out.WorkItems = sortedBy(out.WorkItems, func(v catalog.WorkItem) string { return v.ID })
	out.WorkItemLinks = sortedBy(out.WorkItemLinks, func(v catalog.WorkItemLink) string { return v.WorkItem + "\x00" + v.Target.Kind + "\x00" + v.Target.ID })
	out.Annotations = sortedBy(out.Annotations, func(v catalog.CatalogAnnotation) string {
		return v.Target.Kind + "\x00" + v.Target.ID + "\x00" + v.Source
	})
	return out
}

func sortedBy[T any](values []T, key func(T) string) []T {
	out := slices.Clone(values)
	slices.SortFunc(out, func(a, b T) int { return strings.Compare(key(a), key(b)) })
	return out
}

func sortedStrings(values []string) []string {
	out := slices.Clone(values)
	slices.Sort(out)
	return out
}

func compact(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			out = append(out, value)
		}
	}
	return out
}

func uniqueRelationships(values []relationship) []relationship {
	seen := map[string]bool{}
	out := make([]relationship, 0, len(values))
	for _, value := range values {
		key := value.Label + "\x00" + value.ID
		if value.ID == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, value)
	}
	slices.SortFunc(out, func(a, b relationship) int {
		return strings.Compare(a.Label+"\x00"+a.ID, b.Label+"\x00"+b.ID)
	})
	return out
}

func countServices(cat catalog.Catalog) int {
	total := 0
	for _, ctx := range cat.Contexts {
		total += len(ctx.Services)
	}
	return total
}

func kindOrder(kind string) int {
	switch kind {
	case "context":
		return 0
	case "service":
		return 1
	case "aggregate":
		return 2
	case "event":
		return 3
	case "store":
		return 4
	case "flow":
		return 5
	case "external":
		return 6
	case "module":
		return 7
	case "adr":
		return 8
	case "rfc":
		return 9
	case "spec":
		return 10
	default:
		return 11
	}
}

func groupLabel(kind catalog.GroupKind) string {
	if kind == "" || kind == catalog.GroupKindBoundedContext {
		return "bounded context"
	}
	return strings.ReplaceAll(string(kind), "-", " ")
}

func componentLabel(kind catalog.ComponentKind) string {
	if kind == "" || kind == catalog.ComponentKindService {
		return "service"
	}
	return strings.ReplaceAll(string(kind), "-", " ")
}

func eventBadges(event catalog.Event) []string {
	badges := []string{}
	if event.Wire != nil {
		badges = append(badges, compact(event.Wire.Name, event.Wire.Channel)...)
	}
	return badges
}

func lede(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	if i := strings.Index(text, "\n\n"); i >= 0 {
		text = text[:i]
	}
	text = strings.TrimSpace(strings.TrimLeft(text, "# "))
	if len([]rune(text)) > 280 {
		runes := []rune(text)
		text = string(runes[:277]) + "…"
	}
	return text
}
