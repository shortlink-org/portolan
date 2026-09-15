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
	spellFromRepository(in, &fragment)

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}

	b.File(firstNonEmpty(opts.Out, "domain.json"), string(encoded)+"\n")

	return b.Response(), nil
}

// spellFromRepository respells every place in the fragment from the service's
// repository. The reader spells a place as it opened the file, from the
// workspace with the root in front, and matches places on that spelling while
// it reads - a handler a flow already covers, a step's call-site evidence - so
// the respelling happens once, on the finished fragment. In a monorepo the
// workspace is the repository and nothing changes; a fetched copy loses the
// directory it sits in. Function keys (entrypoint, continuesAt, reaches) are
// names, not places, and stay.
func spellFromRepository(in plugin.Input, fragment *catalog.Catalog) {
	for c := range fragment.Contexts {
		services := fragment.Contexts[c].Services
		for s := range services {
			services[s].Path = in.RepositoryPath(services[s].Path)
			for i := range services[s].Consumes {
				call := &services[s].Consumes[i]
				call.Source = in.RepositorySource(call.Source)
				call.Evidence = spelledEvidence(in, call.Evidence)
			}
			for a := range services[s].Aggregates {
				aggregate := &services[s].Aggregates[a]
				for o := range aggregate.Operations {
					aggregate.Operations[o].Source = in.RepositorySource(aggregate.Operations[o].Source)
				}
				for e := range aggregate.Events {
					for v := range aggregate.Events[e].Versions {
						version := &aggregate.Events[e].Versions[v]
						version.Source = in.RepositorySource(version.Source)
					}
				}
				if aggregate.Lifecycle != nil {
					for t := range aggregate.Lifecycle.Transitions {
						transition := &aggregate.Lifecycle.Transitions[t]
						transition.Source = in.RepositorySource(transition.Source)
					}
				}
			}
		}
	}
	for f := range fragment.Flows {
		fragment.Flows[f].Source = in.RepositorySource(fragment.Flows[f].Source)
		spellNodes(in, fragment.Flows[f].Steps)
	}
}

func spellNodes(in plugin.Input, nodes catalog.FlowNodes) {
	for _, node := range nodes {
		switch node := node.(type) {
		case *catalog.Step:
			node.Line = in.RepositorySource(node.Line)
			node.Evidence = spelledEvidence(in, node.Evidence)
			if node.HTTP != nil {
				response := *node.HTTP
				response.Source = in.RepositorySource(response.Source)
				node.HTTP = &response
			}
		case *catalog.Alt:
			for branch := range node.Branches {
				spellNodes(in, node.Branches[branch].Steps)
			}
		case *catalog.Parallel:
			for _, branch := range node.Branches {
				spellNodes(in, branch)
			}
		case *catalog.Loop:
			spellNodes(in, node.Steps)
		}
	}
}

// spelledEvidence is a respelled copy: a list of evidence can be shared by
// the steps of one draft, and each place is respelled once.
func spelledEvidence(in plugin.Input, evidence []catalog.RelationEvidence) []catalog.RelationEvidence {
	if evidence == nil {
		return nil
	}
	out := make([]catalog.RelationEvidence, len(evidence))
	for i, item := range evidence {
		item.Source = in.RepositorySource(item.Source)
		// The enclosing function is named by its package directory as the
		// reader opened it, `<dir>:<Recv>.<Method>`: a place too.
		if item.Rule == "source-function" {
			if dir, name, ok := strings.Cut(item.Symbol, ":"); ok {
				if dir = in.RepositoryPath(dir); dir == "" {
					item.Symbol = name
				} else {
					item.Symbol = dir + ":" + name
				}
			}
		}
		out[i] = item
	}
	return out
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
