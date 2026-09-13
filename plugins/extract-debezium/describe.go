package extractdebezium

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-debezium",
		Summary:  "Reads PostgreSQL Debezium connector JSON and Strimzi KafkaConnector manifests into source stores, Kafka channels and CDC or outbox flows.",
		Category: plugin.CategoryMessaging,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
