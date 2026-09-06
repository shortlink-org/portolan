package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-adr",
		Summary: "Reads decision records written by hand - MADR markdown with a title, meta bullets and the record itself, or the numbered records adr-tools writes - into a catalog fragment.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
