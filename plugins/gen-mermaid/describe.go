package genmermaid

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name: "gen-mermaid", Summary: "Exports every flow as a standalone Mermaid sequence diagram.",
		Category: plugin.CategoryExports,
		Phases:   []string{plugin.PhaseGenerate}, Options: optionsSchema,
	}
}
