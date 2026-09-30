package extractgokafka

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-go-kafka",
		Summary:  "Reads sarama, kafka-go, confluent-kafka-go and franz-go calls, through the port that wraps them, into the Kafka topics a service consumes and produces.",
		Category: plugin.CategoryMessaging,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
