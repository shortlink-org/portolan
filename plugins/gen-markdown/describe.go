package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "gen-markdown",
		Summary: "Renders the merged catalog as a directory of markdown: a page per context, service, aggregate, store and flow.",
		Phases:  []string{plugin.PhaseGenerate},
		Options: optionsSchema,
	}
}
