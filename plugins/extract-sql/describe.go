package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-sql",
		Summary: "Reads a service's migrations and answers with the store it builds: tables, columns, keys, and which aggregate each table persists.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
