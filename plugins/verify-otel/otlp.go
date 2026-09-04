package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// A span, flattened out of the OTLP shape into the few things a hop is read
// from. Attribute values are kept as strings: everything matched on is a
// name, and a number that mattered would be a number in a string here.
type span struct {
	traceID  string
	spanID   string
	parentID string
	name     string
	kind     int
	service  string
	start    uint64
	attrs    map[string]string
	file     string
}

const (
	kindInternal = 1
	kindServer   = 2
	kindClient   = 3
	kindProducer = 4
	kindConsumer = 5
)

// readTraces reads every file the globs name under root, in path order, so
// that the fragment does not depend on the order a directory happens to list.
func readTraces(root string, patterns []string) ([]span, []string, error) {
	var files []string
	seen := map[string]bool{}
	for _, pattern := range patterns {
		matches, err := filepath.Glob(filepath.Join(root, pattern))
		if err != nil {
			return nil, nil, fmt.Errorf("traces %q: %w", pattern, err)
		}
		for _, match := range matches {
			if !seen[match] {
				seen[match] = true
				files = append(files, match)
			}
		}
	}
	sort.Strings(files)

	var spans []span
	var names []string
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, nil, err
		}
		rel, err := filepath.Rel(root, file)
		if err != nil {
			rel = file
		}
		rel = filepath.ToSlash(rel)
		parsed, err := parseOTLP(data, rel)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", rel, err)
		}
		spans = append(spans, parsed...)
		names = append(names, rel)
	}

	return spans, names, nil
}

type otlpBatch struct {
	ResourceSpans []struct {
		Resource struct {
			Attributes []otlpAttr `json:"attributes"`
		} `json:"resource"`
		ScopeSpans []struct {
			Spans []otlpSpan `json:"spans"`
		} `json:"scopeSpans"`
	} `json:"resourceSpans"`
}

type otlpSpan struct {
	TraceID           string          `json:"traceId"`
	SpanID            string          `json:"spanId"`
	ParentSpanID      string          `json:"parentSpanId"`
	Name              string          `json:"name"`
	Kind              json.RawMessage `json:"kind"`
	StartTimeUnixNano string          `json:"startTimeUnixNano"`
	Attributes        []otlpAttr      `json:"attributes"`
}

type otlpAttr struct {
	Key   string                     `json:"key"`
	Value map[string]json.RawMessage `json:"value"`
}

// parseOTLP reads one JSON value, or one per line: a collector's file
// exporter writes the second, an export saved from a viewer the first, and
// the decoder does not care which.
func parseOTLP(data []byte, file string) ([]span, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	var out []span
	for {
		var batch otlpBatch
		err := dec.Decode(&batch)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		for _, rs := range batch.ResourceSpans {
			service := attrs(rs.Resource.Attributes)["service.name"]
			for _, ss := range rs.ScopeSpans {
				for _, s := range ss.Spans {
					start, _ := strconv.ParseUint(s.StartTimeUnixNano, 10, 64)
					out = append(out, span{
						traceID:  s.TraceID,
						spanID:   s.SpanID,
						parentID: s.ParentSpanID,
						name:     s.Name,
						kind:     spanKind(s.Kind),
						service:  service,
						start:    start,
						attrs:    attrs(s.Attributes),
						file:     file,
					})
				}
			}
		}
	}

	return out, nil
}

func attrs(list []otlpAttr) map[string]string {
	out := map[string]string{}
	for _, a := range list {
		if v, ok := attrString(a.Value); ok {
			out[a.Key] = v
		}
	}

	return out
}

// attrString reads the one-of an OTLP value is: a string, or a number or bool
// spelled as one. Arrays and maps are not names and are left out.
func attrString(value map[string]json.RawMessage) (string, bool) {
	for _, key := range []string{"stringValue", "intValue", "boolValue", "doubleValue"} {
		raw, ok := value[key]
		if !ok {
			continue
		}
		var s string
		if err := json.Unmarshal(raw, &s); err == nil {
			return s, true
		}
		// A number or a bool, unquoted.
		return strings.TrimSpace(string(raw)), true
	}

	return "", false
}

// spanKind reads the enum however it was written: protojson gives the number,
// some exporters the name.
func spanKind(raw json.RawMessage) int {
	var n int
	if err := json.Unmarshal(raw, &n); err == nil {
		return n
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		switch strings.TrimPrefix(s, "SPAN_KIND_") {
		case "INTERNAL":
			return kindInternal
		case "SERVER":
			return kindServer
		case "CLIENT":
			return kindClient
		case "PRODUCER":
			return kindProducer
		case "CONSUMER":
			return kindConsumer
		}
	}

	return 0
}
