package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-http-clients",
		Summary: "Reads outbound net/http, oapi-codegen, and SOAP calls into source-backed dependencies and flows.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
