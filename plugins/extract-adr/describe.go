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
		Summary: "Reads decision records written by hand as MADR markdown - a title, meta bullets, and the record itself - into a catalog fragment.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
