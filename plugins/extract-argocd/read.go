package extractargocd

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/shortlink-org/portolan/plugin"
)

// document is one Argo CD object as far as this reader cares: where it was
// read, what it is, and its body for the readers that know the kind.
type document struct {
	file string
	kind string
	body map[string]any
}

var skippedDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"vendor":       true,
	"target":       true,
}

// readTree reads every YAML document under the paths - the root itself when
// none are named - and keeps the Argo CD Applications and ApplicationSets.
// A file that will not parse is a warning naming the file, never its text.
// Unlike a manifest reader, `{{` is not a reason to pass a file over: an
// ApplicationSet's template is full of them, inside quoted strings, and
// that is YAML.
func readTree(root string, paths []string, b *plugin.Builder) ([]document, error) {
	dirs := []string{root}
	if len(paths) > 0 {
		dirs = dirs[:0]
		for _, p := range paths {
			dirs = append(dirs, filepath.Join(root, filepath.FromSlash(p)))
		}
	}

	var docs []document
	for _, dir := range dirs {
		err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				if path != dir && skippedDirs[entry.Name()] {
					return filepath.SkipDir
				}
				return nil
			}
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			if ext != ".yaml" && ext != ".yml" {
				return nil
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			rel := filepath.ToSlash(path)
			found, parseErr := documentsIn(raw)
			if parseErr != nil {
				b.Warn(rel, "could not be parsed as YAML and is passed over: "+parseErr.Error())
				return nil
			}
			for _, body := range found {
				kind, _ := body["kind"].(string)
				apiVersion, _ := body["apiVersion"].(string)
				if !strings.HasPrefix(apiVersion, "argoproj.io/") {
					continue
				}
				if kind != "Application" && kind != "ApplicationSet" {
					continue
				}
				docs = append(docs, document{file: rel, kind: kind, body: body})
			}
			return nil
		})
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				b.Warn(filepath.ToSlash(dir), "does not exist")
				continue
			}
			return nil, err
		}
	}
	sort.SliceStable(docs, func(i, j int) bool { return docs[i].file < docs[j].file })
	return docs, nil
}

// documentsIn splits a multi-document file. A document that is not a map -
// a bare string, a list - is not an object and is dropped without a word.
func documentsIn(raw []byte) ([]map[string]any, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(raw))
	var out []map[string]any
	for {
		var body map[string]any
		err := decoder.Decode(&body)
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		if body != nil {
			out = append(out, body)
		}
	}
}

// str reads a string field of a map, "" when absent or not a string.
func str(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	value, _ := m[key].(string)
	return strings.TrimSpace(value)
}

// sub reads a map field of a map, nil when absent or not a map.
func sub(m map[string]any, key string) map[string]any {
	if m == nil {
		return nil
	}
	value, _ := m[key].(map[string]any)
	return value
}

// list reads a list field of a map, nil when absent or not a list.
func list(m map[string]any, key string) []any {
	if m == nil {
		return nil
	}
	value, _ := m[key].([]any)
	return value
}

// stringMap reads a map of strings, dropping what is not a string.
func stringMap(m map[string]any, key string) map[string]string {
	out := map[string]string{}
	for k, v := range sub(m, key) {
		if s, ok := v.(string); ok {
			out[k] = s
		}
	}
	return out
}
