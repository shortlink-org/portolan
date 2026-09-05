package main

import (
	"slices"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// canonicalCatalog sorts only collections whose order carries no meaning.
// Fields, event versions, lifecycle transitions, flow participants and flow
// nodes deliberately keep their declared order.
func canonicalCatalog(cat catalog.Catalog) catalog.Catalog {
	out := cat
	out.Contexts = slices.Clone(cat.Contexts)
	slices.SortFunc(out.Contexts, func(a, b catalog.BoundedContext) int { return strings.Compare(a.ID, b.ID) })
	for i := range out.Contexts {
		ctx := &out.Contexts[i]
		ctx.Services = slices.Clone(ctx.Services)
		slices.SortFunc(ctx.Services, func(a, b catalog.Service) int { return strings.Compare(a.ID, b.ID) })
		for j := range ctx.Services {
			svc := &ctx.Services[j]
			svc.Aggregates = slices.Clone(svc.Aggregates)
			slices.SortFunc(svc.Aggregates, func(a, b catalog.Aggregate) int { return strings.Compare(a.ID, b.ID) })
			for k := range svc.Aggregates {
				agg := &svc.Aggregates[k]
				agg.Entities = slices.Clone(agg.Entities)
				slices.SortFunc(agg.Entities, func(a, b catalog.Block) int { return strings.Compare(a.ID, b.ID) })
				agg.ValueObjects = slices.Clone(agg.ValueObjects)
				slices.SortFunc(agg.ValueObjects, func(a, b catalog.Block) int { return strings.Compare(a.ID, b.ID) })
				agg.Operations = slices.Clone(agg.Operations)
				slices.SortFunc(agg.Operations, func(a, b catalog.Operation) int { return strings.Compare(a.ID, b.ID) })
				agg.Events = slices.Clone(agg.Events)
				slices.SortFunc(agg.Events, func(a, b catalog.Event) int { return strings.Compare(a.ID, b.ID) })
			}
			svc.Provides = canonicalProvides(svc.Provides)
			svc.Consumes = slices.Clone(svc.Consumes)
			slices.SortFunc(svc.Consumes, func(a, b catalog.RpcCall) int { return strings.Compare(a.ID, b.ID) })
			svc.Stores = sortedStrings(svc.Stores)
			svc.Modules = sortedStrings(svc.Modules)
			svc.Channels = slices.Clone(svc.Channels)
			slices.SortFunc(svc.Channels, func(a, b catalog.Channel) int { return strings.Compare(a.Address, b.Address) })
		}
	}
	out.Stores = slices.Clone(cat.Stores)
	slices.SortFunc(out.Stores, func(a, b catalog.Store) int { return strings.Compare(a.ID, b.ID) })
	out.Flows = slices.Clone(cat.Flows)
	slices.SortFunc(out.Flows, func(a, b catalog.Flow) int { return strings.Compare(a.ID, b.ID) })
	out.Adrs = slices.Clone(cat.Adrs)
	slices.SortFunc(out.Adrs, func(a, b catalog.Adr) int { return strings.Compare(a.ID, b.ID) })
	out.Modules = slices.Clone(cat.Modules)
	slices.SortFunc(out.Modules, func(a, b catalog.ProtoModule) int { return strings.Compare(a.ID, b.ID) })
	for i := range out.Modules {
		out.Modules[i].Packages = sortedStrings(out.Modules[i].Packages)
		out.Modules[i].Files = sortedStrings(out.Modules[i].Files)
		out.Modules[i].Deps = sortedStrings(out.Modules[i].Deps)
	}
	out.Terms = slices.Clone(cat.Terms)
	slices.SortFunc(out.Terms, func(a, b catalog.Term) int {
		if a.Context != b.Context {
			return strings.Compare(a.Context, b.Context)
		}
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	out.Externals = slices.Clone(cat.Externals)
	slices.SortFunc(out.Externals, func(a, b catalog.External) int { return strings.Compare(a.ID, b.ID) })
	for i := range out.Externals {
		out.Externals[i].Provides = canonicalProvides(out.Externals[i].Provides)
	}
	return out
}

func canonicalProvides(input []catalog.RpcService) []catalog.RpcService {
	out := slices.Clone(input)
	slices.SortFunc(out, func(a, b catalog.RpcService) int { return strings.Compare(a.ID, b.ID) })
	for i := range out {
		out[i].Methods = slices.Clone(out[i].Methods)
		slices.SortFunc(out[i].Methods, func(a, b catalog.RpcMethod) int { return strings.Compare(a.Name, b.Name) })
		out[i].Messages = slices.Clone(out[i].Messages)
		slices.SortFunc(out[i].Messages, func(a, b catalog.RpcMessage) int { return strings.Compare(a.Name, b.Name) })
	}
	return out
}

func sortedStrings(input []string) []string {
	out := slices.Clone(input)
	slices.Sort(out)
	return out
}
