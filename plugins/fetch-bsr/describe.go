package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "fetch-bsr",
		Summary: "Fetches pinned modules from a Buf Schema Registry into the tree, with a lock beside each, so the proto extractor can read a published contract.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
