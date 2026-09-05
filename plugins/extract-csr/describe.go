package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-csr",
		Summary: "Reads schemas vendored out of a Confluent Schema Registry and answers with the topics they are registered against and the shapes they declare.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
