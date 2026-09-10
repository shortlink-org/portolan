package extracthttpclients

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-http-clients",
		Summary:  "Reads outbound HTTP/SOAP calls and joins Go routes, handlers, factories, and providers into source-backed flows.",
		Category: plugin.CategoryCode,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
