package extractterraform

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-terraform",
		Summary:  "Reads AWS and Azure Event Grid Terraform into the queues, topics, functions and stores it declares, and the subscriptions, filters, triggers and dead-letter routes that join them.",
		Category: plugin.CategoryInfrastructure,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
