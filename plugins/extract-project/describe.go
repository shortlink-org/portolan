package extractproject

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-project",
		Summary: "Reads repository metadata and describes a group and component without assuming DDD or a particular language.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
