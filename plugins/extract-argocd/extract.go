package extractargocd

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// extract reads the tree under in.Root for Applications and ApplicationSets
// and answers with one fragment: the deployments they declare, sorted by id.
// repoRoot is where a git generator's repository-relative paths are walked
// from - the workspace, which is the repository, when the host runs this.
func extract(in plugin.Input, opts Options, repoRoot string) (plugin.Response, error) {
	opts = opts.withDefaults()
	b := &plugin.Builder{}
	docs, err := readTree(in.Root, opts.Paths, b)
	if err != nil {
		return plugin.Response{}, err
	}

	var apps []map[string]any
	for _, doc := range docs {
		switch doc.kind {
		case "Application":
			apps = append(apps, doc.body)
		case "ApplicationSet":
			apps = append(apps, applications(doc, repoRoot, opts.Repo, b)...)
		}
	}

	byID := map[string]string{}
	var deployments []catalog.Deployment
	for _, app := range apps {
		d, ok := deploymentOf(app, repoRoot, opts)
		if !ok {
			b.Warn(in.Root, "an Application without a name is passed over")
			continue
		}
		if first, seen := byID[d.ID]; seen {
			b.Warn(in.Root, fmt.Sprintf("%s is declared twice; the first, %s, is kept", d.ID, first))
			continue
		}
		byID[d.ID] = d.Name
		deployments = append(deployments, d)
	}
	sort.Slice(deployments, func(i, j int) bool { return deployments[i].ID < deployments[j].ID })
	if len(deployments) == 0 {
		b.Warn(in.Root, "no Application or ApplicationSet was found")
	}

	fragment := catalog.Catalog{
		Contexts:    []catalog.BoundedContext{},
		Defs:        map[string]catalog.TypeDef{},
		Flows:       []catalog.Flow{},
		Adrs:        []catalog.Adr{},
		Deployments: deployments,
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(opts.Out, string(encoded)+"\n")
	return b.Response(), nil
}
