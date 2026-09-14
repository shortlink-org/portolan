package extractrfc

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-rfc",
		Summary:  "Reads RFC and RFD proposal documents while preserving their own review lifecycle and discussion metadata.",
		Category: plugin.CategoryDocuments,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
		Needs:    []string{plugin.NeedHistory},
	}
}
