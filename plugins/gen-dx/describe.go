package gendx

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name: "gen-dx", Summary: "Exports services and their dependencies as an explicit DX Software Catalog apply plan.",
		Category: plugin.CategoryExports, Phases: []string{plugin.PhaseGenerate}, Options: optionsSchema,
	}
}
