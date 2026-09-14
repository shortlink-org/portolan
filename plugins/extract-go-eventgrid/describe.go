package extractgoeventgrid

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-go-eventgrid",
		Summary:  "Reads Azure SDK for Go Event Grid publisher calls into the topics and event types a service publishes.",
		Category: plugin.CategoryMessaging,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
