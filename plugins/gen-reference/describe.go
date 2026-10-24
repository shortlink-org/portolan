package genreference

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "gen-reference",
		Summary:  "Exports one catalog profile as a searchable, self-contained HTML architecture reference.",
		Category: plugin.CategoryExports,
		Phases:   []string{plugin.PhaseGenerate},
		Options:  optionsSchema,
	}
}
