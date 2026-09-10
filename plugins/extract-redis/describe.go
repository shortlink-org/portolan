package extractredis

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-redis",
		Summary:  "Finds runtime construction of supported Go Redis clients and adds the service-owned Redis store to the catalog.",
		Category: plugin.CategoryData,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
