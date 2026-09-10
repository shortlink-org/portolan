package extractgraphql

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-graphql",
		Summary:  "Reads a GraphQL schema and answers with the interfaces a service provides, one per schema module.",
		Category: plugin.CategoryContracts,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
