package extractsql

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-sql",
		Summary:  "Reads a service's migrations and Go repository SQL into the store it builds: tables, columns, keys, persisted aggregates, and the methods that read or write each table.",
		Category: plugin.CategoryData,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
