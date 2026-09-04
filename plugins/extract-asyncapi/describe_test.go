package main

import (
	"testing"

	"github.com/shortlink-org/portolan/plugin/schematest"
)

func TestOptionsSchemaMatchesStruct(t *testing.T) {
	schematest.Check(t, optionsSchema, Options{})
}
