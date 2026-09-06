package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-watermill",
		Summary: "Reads Watermill router and CQRS handlers plus publications into channels and source-backed message flows.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
