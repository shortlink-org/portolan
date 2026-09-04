package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-asyncapi",
		Summary: "Reads an AsyncAPI document and answers with the channels a service publishes on and listens to.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
