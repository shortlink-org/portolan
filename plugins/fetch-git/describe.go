package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "fetch-git",
		Summary: "Fetches pinned directories of another git repository into the tree, with a lock, so extractors can read a service that lives elsewhere.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
