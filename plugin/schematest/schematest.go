// Package schematest checks that a plugin's options schema still describes its
// options struct.
//
// The schema is written by hand rather than reflected out of the struct,
// because what makes it worth having is the prose: which slug a store expects,
// whose proto package a peer answers for. None of that survives reflection.
// What reflection is good for is the half nobody would notice going stale - a
// field renamed, a field added, a schema left behind - so that is all this
// does.
package schematest

import (
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"
)

type document struct {
	Type                 string                     `json:"type"`
	AdditionalProperties *bool                      `json:"additionalProperties"`
	Properties           map[string]json.RawMessage `json:"properties"`
	Required             []string                   `json:"required"`
}

// Check reports every way the schema and the struct have come apart.
//
// options is a zero value of the plugin's options type; schema is the embedded
// document it hands back when asked to describe itself.
func Check(t *testing.T, schema []byte, options any) {
	t.Helper()

	var doc document
	if err := json.Unmarshal(schema, &doc); err != nil {
		t.Fatalf("options schema is not JSON: %v", err)
	}

	if doc.Type != "object" {
		t.Errorf("options schema has type %q, want object", doc.Type)
	}

	// Without this an unknown key validates, and the misspelled option - the
	// one error this whole mechanism exists to catch - goes through silently.
	if doc.AdditionalProperties == nil || *doc.AdditionalProperties {
		t.Error("options schema must set additionalProperties: false")
	}

	described := keys(doc.Properties)
	declared := fields(reflect.TypeOf(options))

	for _, name := range missing(declared, described) {
		t.Errorf("option %q is in the struct but not in the schema", name)
	}
	for _, name := range missing(described, declared) {
		t.Errorf("option %q is in the schema but not in the struct", name)
	}

	for _, name := range doc.Required {
		if _, ok := doc.Properties[name]; !ok {
			t.Errorf("option %q is required but not described", name)
		}
	}

	// A property with nothing to say is a property the manifest schema will
	// offer with no hint of what it means, which is where this started.
	for name, raw := range doc.Properties {
		var property struct {
			Description string `json:"description"`
		}
		if err := json.Unmarshal(raw, &property); err != nil {
			t.Errorf("option %q: %v", name, err)

			continue
		}
		if strings.TrimSpace(property.Description) == "" {
			t.Errorf("option %q has no description", name)
		}
	}
}

// fields are the json names of an options struct, which is the only shape this
// takes: a plugin's options are a flat object read out of the manifest.
func fields(t reflect.Type) []string {
	var names []string

	for i := 0; i < t.NumField(); i++ {
		tag := t.Field(i).Tag.Get("json")
		name, _, _ := strings.Cut(tag, ",")
		if name == "" || name == "-" {
			continue
		}
		names = append(names, name)
	}

	sort.Strings(names)

	return names
}

func keys(m map[string]json.RawMessage) []string {
	names := make([]string, 0, len(m))
	for name := range m {
		names = append(names, name)
	}
	sort.Strings(names)

	return names
}

// missing is everything in a that is not in b.
func missing(a, b []string) []string {
	have := make(map[string]bool, len(b))
	for _, name := range b {
		have[name] = true
	}

	var gone []string
	for _, name := range a {
		if !have[name] {
			gone = append(gone, name)
		}
	}

	return gone
}
