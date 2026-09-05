package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "verify-codeowners",
		Summary: "Reads the repository's CODEOWNERS against the catalog: who to ask about each service, which services nobody owns, and which rules own nothing.",
		Phases:  []string{plugin.PhaseVerify},
		Options: optionsSchema,
	}
}
