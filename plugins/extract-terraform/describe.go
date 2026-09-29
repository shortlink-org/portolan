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
		Summary:  "Reads AWS, Azure Event Grid and Azure Service Bus Terraform into the queues, topics, functions and stores it declares, and the subscriptions, filters, triggers, grants and dead-letter routes that join them.",
		Category: plugin.CategoryInfrastructure,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
