package extractk8s

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-k8s",
		Summary:  "Reads Kubernetes manifests into the names a service answers on and the in-cluster names it dials; values and secrets are never kept.",
		Phases:   []string{plugin.PhaseExtract},
		Category: plugin.CategoryInfrastructure,
		Options:  optionsSchema,
	}
}
