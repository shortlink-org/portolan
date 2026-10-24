package extractsdd

import (
	_ "embed"
	"encoding/json"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name: "extract-sdd", Summary: "Read OpenSpec changes, requirements and tasks.",
		Category: plugin.CategoryDocuments, Phases: []string{plugin.PhaseExtract},
		Options: json.RawMessage(optionsSchema),
	}
}
