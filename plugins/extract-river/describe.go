package extractriver

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-river",
		Summary: "Reads River JobArgs, Insert calls and registered workers into work queues and source-backed job flows.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
