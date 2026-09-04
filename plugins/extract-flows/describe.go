package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-flows",
		Summary: "Reads flows written by hand as *.flow.md - one line per hop, frames closed by end - into a catalog fragment.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
