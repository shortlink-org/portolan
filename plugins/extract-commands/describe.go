package extractcommands

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-commands",
		Summary:  "Reads the make targets, npm scripts, just recipes and task-runner tasks a repository declares onto its service.",
		Category: plugin.CategoryRepository,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
