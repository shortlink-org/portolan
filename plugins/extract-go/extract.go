package extractgo

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// extract reads a service and answers with one catalog fragment.
//
// A fragment, not a catalog: it carries one context and one service, names
// peers it does not own, and is merged with everything else before anything
// validates it. That is the whole reason the estate does not need a file
// somebody has to own.
func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	root := in.Root

	if opts.Context == "" {
		opts.Context = filepath.Base(root)
	}
	if opts.Service == "" {
		opts.Service = filepath.Base(root)
	}

	svcID := serviceID(opts.Context, opts.Service)
	layout := discoverLayout(root)
	if layout.index != nil {
		for _, diagnostic := range layout.index.Diagnostics {
			b.Warn(svcID, diagnostic)
		}
	}
	if opts.Scope != "" {
		layout = layout.scoped(opts.Scope)
	}

	readme := readFile(filepath.Join(root, "README.md"))
	service := catalog.Service{
		ID:       svcID,
		Slug:     opts.Service,
		Name:     firstNonEmpty(opts.ServiceName, markdownTitle(readme), title(opts.Service)),
		Repo:     firstNonEmpty(opts.Repo, modulePath(root)),
		Path:     filepath.ToSlash(root),
		Readme:   readme,
		Provides: []catalog.RpcService{},
		Consumes: []catalog.RpcCall{},
	}

	// Operations live in the application layer and belong to the aggregate the
	// use case sits under, so they are gathered first and handed out below.
	// What exposes each one is read from the transport layer beside it, and the
	// endpoints that came back are where the flows start.
	exposures, endpoints := extractTransport(root, layout, b)
	operations := extractOperations(root, layout, exposures, b)

	for _, aggregateName := range sortedKeys(layout.domains) {
		aggregate, ok := extractAggregate(root, aggregateName, layout.domains[aggregateName], layout, svcID, b)
		if !ok {
			continue
		}
		aggregate.Operations = operations[aggregateName]
		if aggregate.Operations == nil {
			aggregate.Operations = []catalog.Operation{}
		}

		service.Aggregates = append(service.Aggregates, aggregate)
	}

	if len(service.Aggregates) == 0 {
		service.Aggregates = []catalog.Aggregate{}
	}

	for aggregate, ops := range operations {
		if !hasAggregate(service.Aggregates, aggregateID(svcID, slug(aggregate))) {
			b.Warn(svcID, "application slice "+aggregate+" has "+plural(len(ops))+" but there is no matching aggregate domain package")
		}
	}

	// Flows are read last, because a flow names the events the aggregates
	// declare and an event nothing reaches is worth reporting.
	flows, calls := extractFlows(root, flowOptions{
		context:   opts.Context,
		svcID:     svcID,
		service:   opts.Service,
		store:     opts.Store,
		peers:     opts.Peers,
		externals: opts.Externals,
		events:    opts.Events,
	}, layout, endpoints, eventIDs(service.Aggregates), b)
	// Registered execution roots do not require a DDD layout or a deployable
	// scope. Keep the richer domain flow when it already covers a handler.
	covered := map[string]bool{}
	for _, endpoint := range endpoints {
		covered[at(endpoint.source, endpoint.line)] = true
	}
	serviceFlows, serviceCalls := extractServiceFlows(root, opts, b, covered, layout)
	flows = append(flows, serviceFlows...)
	calls = mergeRPCCalls(calls, serviceCalls)
	if len(service.Aggregates) == 0 && len(flows) == 0 && opts.Scope == "" {
		b.Warn(svcID, "no aggregate domain packages or supported execution flows found")
	}
	// What the service calls is read off its flows: the generated client in
	// the tree names the rpc, and a step on it is the call being made.
	service.Consumes = calls

	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID:             opts.Context,
			Slug:           opts.Context,
			Name:           firstNonEmpty(opts.ContextName, title(opts.Context)),
			Summary:        opts.ContextSummary,
			Classification: catalog.Classification(opts.Classification),
			Services:       []catalog.Service{service},
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: flows,
		Adrs:  []catalog.Adr{},
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}

	b.File(firstNonEmpty(opts.Out, "domain.json"), string(encoded)+"\n")

	return b.Response(), nil
}

// eventIDs is every fact the service publishes, which is what a flow reader is
// held to: an event no flow reaches is an event whose publisher this could not
// follow.
func eventIDs(aggregates []catalog.Aggregate) []string {
	var out []string
	for i := range aggregates {
		for j := range aggregates[i].Events {
			out = append(out, aggregates[i].Events[j].ID)
		}
	}

	return out
}

func hasAggregate(aggregates []catalog.Aggregate, id string) bool {
	for i := range aggregates {
		if aggregates[i].ID == id {
			return true
		}
	}

	return false
}

func readFile(path string) string {
	contents, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	return strings.TrimSpace(string(contents))
}

// modulePath is the module line of go.mod, which is the closest thing the
// source has to a repository name.
func modulePath(root string) string {
	for _, line := range strings.Split(readFile(filepath.Join(root, "go.mod")), "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
			return strings.TrimSpace(rest)
		}
	}

	return ""
}

// markdownTitle is the first `# ` heading of a readme, which is what the
// service is actually called.
func markdownTitle(md string) string {
	for _, line := range strings.Split(md, "\n") {
		if heading, ok := strings.CutPrefix(strings.TrimSpace(line), "# "); ok {
			return strings.TrimSpace(heading)
		}
	}

	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}

func plural(n int) string {
	if n == 1 {
		return "1 use case"
	}

	return strconv.Itoa(n) + " use cases"
}
