package verifyotel

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "verify-otel",
		Summary:  "Reads OpenTelemetry traces against the catalog and says which hops have been seen running.",
		Category: plugin.CategoryEvidence,
		Phases:   []string{plugin.PhaseVerify},
		Options:  optionsSchema,
	}
}
