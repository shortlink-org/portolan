package extractgo

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-go",
		Summary: "Reads Go source with go/parser: domain aggregates, events and use cases, plus registered HTTP execution flows in conventional services.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
