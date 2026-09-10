package extractgosqs

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-go-sqs",
		Summary: "Reads aws-sdk-go-v2 SQS calls, through the port that wraps them, into the queues a service sends to and receives from.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
