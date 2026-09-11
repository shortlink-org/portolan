package extractargocd

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-argocd",
		Summary:  "Reads the Argo CD Applications and ApplicationSets in a GitOps tree into the deployments they declare - which service, from where, into which cluster and namespace - expanding list, git and matrix generators against the tree.",
		Phases:   []string{plugin.PhaseExtract},
		Category: plugin.CategoryInfrastructure,
		Options:  optionsSchema,
	}
}
