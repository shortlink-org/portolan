package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-proto",
		Summary: "Reads .proto files and answers with what a service provides from the modules it publishes and what it calls from the copies it vendors.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
