package catalog

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// TestRoundTrip is what holds this package to src/catalog.ts.
//
// Every real catalog in the repository is unmarshalled into these structs and
// marshalled straight back out. Anything the mirror does not know about is
// dropped on the way in and missing on the way out, so a field added to the
// TypeScript and forgotten here fails as a named path rather than as a blank
// section in somebody's generated documentation.
//
// The comparison is semantic: key order differs by construction, and an
// optional list that was written as [] is the same fact as one left out.
func TestRoundTrip(t *testing.T) {
	files, err := filepath.Glob("../data/*.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no catalogs under ../data - this test proves nothing without one")
	}

	for _, path := range files {
		t.Run(filepath.Base(path), func(t *testing.T) {
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}

			var before any
			if err := json.Unmarshal(raw, &before); err != nil {
				t.Fatalf("source is not JSON: %v", err)
			}

			var parsed Catalog
			if err := json.Unmarshal(raw, &parsed); err != nil {
				t.Fatalf("catalog does not fit the mirror: %v", err)
			}

			out, err := json.Marshal(&parsed)
			if err != nil {
				t.Fatalf("mirror does not marshal: %v", err)
			}

			var after any
			if err := json.Unmarshal(out, &after); err != nil {
				t.Fatal(err)
			}

			diffs := compare("catalog", normalize(before), normalize(after))
			if len(diffs) == 0 {
				return
			}

			shown := diffs
			if len(shown) > 20 {
				shown = shown[:20]
			}
			for _, d := range shown {
				t.Error(d)
			}
			if len(diffs) > len(shown) {
				t.Errorf("... and %d more", len(diffs)-len(shown))
			}
		})
	}
}

// normalize drops keys whose value carries no information. An optional list
// written as [] and one left out entirely say the same thing, and holding the
// mirror to which of the two it produces would test encoding/json rather than
// the shape.
func normalize(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, item := range t {
			switch inner := item.(type) {
			case []any:
				if len(inner) == 0 {
					continue
				}
			case map[string]any:
				if len(inner) == 0 {
					continue
				}
			}
			out[k] = normalize(item)
		}

		return out
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			out[i] = normalize(item)
		}

		return out
	default:
		return v
	}
}

// compare walks both trees together and names every place they part, as a path
// a reader can find in the file.
func compare(path string, before, after any) []string {
	switch b := before.(type) {
	case map[string]any:
		a, ok := after.(map[string]any)
		if !ok {
			return []string{fmt.Sprintf("%s: object in the source, %T after the round trip", path, after)}
		}

		var diffs []string
		for _, key := range sortedKeys(b, a) {
			bv, inSource := b[key]
			av, inMirror := a[key]
			switch {
			case inSource && !inMirror:
				diffs = append(diffs, fmt.Sprintf("%s.%s: dropped by the mirror (%s)", path, key, brief(bv)))
			case !inSource && inMirror:
				diffs = append(diffs, fmt.Sprintf("%s.%s: invented by the mirror (%s)", path, key, brief(av)))
			default:
				diffs = append(diffs, compare(path+"."+key, bv, av)...)
			}
		}

		return diffs
	case []any:
		a, ok := after.([]any)
		if !ok {
			return []string{fmt.Sprintf("%s: list in the source, %T after the round trip", path, after)}
		}
		if len(b) != len(a) {
			return []string{fmt.Sprintf("%s: %d entries in the source, %d after the round trip", path, len(b), len(a))}
		}

		var diffs []string
		for i := range b {
			diffs = append(diffs, compare(fmt.Sprintf("%s[%d]", path, i), b[i], a[i])...)
		}

		return diffs
	default:
		if before != after {
			return []string{fmt.Sprintf("%s: %s became %s", path, brief(before), brief(after))}
		}

		return nil
	}
}

func sortedKeys(maps ...map[string]any) []string {
	seen := map[string]bool{}
	for _, m := range maps {
		for k := range m {
			seen[k] = true
		}
	}

	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	return keys
}

func brief(v any) string {
	s := fmt.Sprintf("%v", v)
	if len(s) > 60 {
		return s[:57] + "..."
	}

	return s
}
