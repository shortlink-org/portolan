package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-go",
		Summary: "Reads a Go service with go/parser alone and answers with its domain: aggregates, events, use cases and the flows they imply.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
