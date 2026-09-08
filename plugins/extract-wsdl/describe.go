package extractwsdl

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "extract-wsdl",
		Summary: "Reads WSDL services, SOAP bindings, operations, messages, faults, and local XSD shapes.",
		Phases:  []string{plugin.PhaseExtract},
		Options: optionsSchema,
	}
}
