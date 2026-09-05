package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "fetch-csr",
		Summary: "Fetches pinned subject versions from a Confluent Schema Registry into the tree, with a lock beside each, so a schema published to a registry can be read without talking to it.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
