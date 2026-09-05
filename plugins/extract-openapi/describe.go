package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-openapi",
		Summary: "Reads an OpenAPI document and answers with the rpc services a service provides, one per tag - or, for a copy vendored from outside the estate, what a third party answers on.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
