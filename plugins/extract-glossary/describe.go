package extractglossary

import (
	_ "embed"

	"github.com/shortlink-org/portolan/plugin"
)

//go:embed options.schema.json
var optionsSchema []byte

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-glossary",
		Summary:  "Reads a context's GLOSSARY.md - one paragraph per term, what it is and what it is not - into a catalog fragment.",
		Category: plugin.CategoryDocuments,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}
