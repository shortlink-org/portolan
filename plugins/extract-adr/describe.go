package extractadr

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-adr",
		Summary: "Reads decision records written by hand - MADR, adr-tools and common ADR-numbered Markdown variants - into a catalog fragment.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
		Needs:   []string{plugin.NeedHistory},
	}
}
