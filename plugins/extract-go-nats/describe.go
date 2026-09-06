package main

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-go-nats",
		Summary: "Reads nats.go and JetStream calls, through the port that wraps them, into the subjects a service listens on and publishes to.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
