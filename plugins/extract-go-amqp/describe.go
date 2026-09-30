package extractgoamqp

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-go-amqp",
		Summary:  "Reads amqp091-go and streadway/amqp publishes, consumes and queue bindings into the RabbitMQ routes a service publishes to and consumes.",
		Category: plugin.CategoryMessaging,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
