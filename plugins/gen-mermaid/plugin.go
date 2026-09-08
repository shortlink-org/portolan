package genmermaid

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	flowmermaid "github.com/shortlink-org/portolan/render/mermaid"
)

type Options struct {
	Title string `json:"title,omitempty"`
}

type indexEntry struct {
	ID      string `json:"id"`
	Slug    string `json:"slug"`
	Name    string `json:"name"`
	Owner   string `json:"owner,omitempty"`
	Source  string `json:"source,omitempty"`
	Diagram string `json:"diagram"`
}

func render(req plugin.Request, opts Options) plugin.Response {
	flows := append([]catalog.Flow(nil), req.Catalog.Flows...)
	sort.Slice(flows, func(i, j int) bool { return flows[i].Slug < flows[j].Slug })
	label := labeler(req.Catalog)
	b := &plugin.Builder{}
	title := opts.Title
	if title == "" {
		title = "Architecture flows"
	}
	var readme strings.Builder
	readme.WriteString("# " + title + "\n\n")
	readme.WriteString("Standalone Mermaid sequence diagrams generated from the portolan catalog.\n\n")
	entries := make([]indexEntry, 0, len(flows))
	for i := range flows {
		flow := &flows[i]
		name := flow.Slug + ".mmd"
		b.File(name, flowmermaid.Sequence(flow, label))
		readme.WriteString("- [" + flow.Name + "](" + name + ") — `" + flow.ID + "`\n")
		entries = append(entries, indexEntry{ID: flow.ID, Slug: flow.Slug, Name: flow.Name, Owner: flow.Owner, Source: flow.Source, Diagram: name})
	}
	encoded, _ := json.MarshalIndent(map[string]any{"version": 1, "flows": entries}, "", "  ")
	b.File("README.md", readme.String())
	b.File("index.json", string(encoded)+"\n")
	return b.Response()
}

func labeler(cat catalog.Catalog) func(*catalog.Step) string {
	methods := map[string]catalog.RpcMethod{}
	services := map[string]*catalog.Service{}
	for i := range cat.Contexts {
		for j := range cat.Contexts[i].Services {
			svc := &cat.Contexts[i].Services[j]
			services[svc.ID] = svc
			for k := range svc.Provides {
				provided := &svc.Provides[k]
				for m := range provided.Methods {
					methods[provided.ID+"/"+provided.Methods[m].Name] = provided.Methods[m]
				}
			}
		}
	}
	for i := range cat.Externals {
		for j := range cat.Externals[i].Provides {
			provided := &cat.Externals[i].Provides[j]
			for m := range provided.Methods {
				methods[provided.ID+"/"+provided.Methods[m].Name] = provided.Methods[m]
			}
		}
	}
	return func(step *catalog.Step) string {
		text := step.Label
		if text == "" {
			text = step.Ref
		}
		if text == "" {
			text = string(step.Kind)
		}
		if step.Kind != catalog.StepRPC {
			return text
		}
		answer := methods[step.Ref].Response
		if step.Ref == "" && step.Label != "" {
			if svc := services[step.To]; svc != nil {
				for i := range svc.Provides {
					for j := range svc.Provides[i].Methods {
						method := &svc.Provides[i].Methods[j]
						if method.Name == step.Label {
							answer = method.Response
						}
					}
				}
			}
		}
		if answer != "" {
			return text + " → " + answer
		}
		return text
	}
}
