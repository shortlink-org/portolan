package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name: "gen-backstage", Summary: "Exports contexts, services, APIs, stores and schema modules as a Backstage catalog.",
		Phases: []string{plugin.PhaseGenerate}, Options: optionsSchema,
	}
}
