package extractk8s

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

// object is one Kubernetes document as far as this reader cares: what it is,
// what it is called, and its body for the readers that know the kind.
type object struct {
	file       string
	apiVersion string
	kind       string
	name       string
	namespace  string
	labels     map[string]string
	body       map[string]any
}

// id is what two documents describing one object share: a base and the
// overlay that patches it, a Deployment and the patch a Kustomization lays
// over it. Folding by it is what makes an overlay read without running
// kustomize.
func (o object) id() string {
	return o.kind + "/" + o.namespace + "/" + o.name
}

// secretKinds are never decoded past their kind. A Secret's data is the one
// thing in a manifest that must not reach a fragment, a warning, or a
// reader's memory for longer than it takes to see the word.
var secretKinds = map[string]bool{
	"Secret":         true,
	"SealedSecret":   true,
	"ExternalSecret": true,
	"SecretStore":    true,
}

var skippedDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"vendor":       true,
	"target":       true,
}

// readTree reads every YAML document under the paths - the root itself when
// none are named - and keeps the ones that are Kubernetes objects. A file
// that holds a template is not YAML until it is rendered, so a directory of
// those is passed over with one warning for the directory, not one per file.
func readTree(root string, paths []string, namespace string, b *plugin.Builder) ([]object, error) {
	dirs := []string{root}
	if len(paths) > 0 {
		dirs = dirs[:0]
		for _, p := range paths {
			dirs = append(dirs, filepath.Join(root, filepath.FromSlash(p)))
		}
	}

	var objects []object
	templated := map[string]bool{}
	for _, dir := range dirs {
		err := filepath.WalkDir(dir, func(p string, entry fs.DirEntry, err error) error {
			if err != nil {
				if errors.Is(err, fs.ErrNotExist) && p == dir {
					b.Warn(rel(root, dir), "no such directory under the input root")
					return fs.SkipDir
				}
				return err
			}
			if entry.IsDir() {
				if p != dir && skippedDirs[entry.Name()] {
					return fs.SkipDir
				}
				return nil
			}
			ext := filepath.Ext(entry.Name())
			if ext != ".yaml" && ext != ".yml" {
				return nil
			}
			raw, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			if bytes.Contains(raw, []byte("{{")) {
				templated[rel(root, filepath.Dir(p))] = true
				return nil
			}
			found, err := readDocuments(rel(root, p), raw)
			if err != nil {
				b.Warn(rel(root, p), "not read: "+err.Error())
				return nil
			}
			for _, o := range found {
				if namespace != "" && o.namespace != "" && o.namespace != namespace {
					continue
				}
				objects = append(objects, o)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	dirsWithTemplates := make([]string, 0, len(templated))
	for d := range templated {
		dirsWithTemplates = append(dirsWithTemplates, d)
	}
	sort.Strings(dirsWithTemplates)
	for _, d := range dirsWithTemplates {
		b.Warn(d, "holds templates ({{ … }}), which are not YAML until rendered; nothing under it was read")
	}

	sort.SliceStable(objects, func(i, j int) bool {
		if objects[i].file != objects[j].file {
			return objects[i].file < objects[j].file
		}
		return objects[i].id() < objects[j].id()
	})
	return objects, nil
}

// readDocuments splits one file into its documents and keeps the Kubernetes
// objects among them. The kind is read before anything else, so that a
// secret is recognised and left alone without its body ever being decoded.
func readDocuments(file string, raw []byte) ([]object, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(raw))
	var out []object
	for {
		var node yaml.Node
		err := decoder.Decode(&node)
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		if node.Kind != yaml.DocumentNode || len(node.Content) == 0 || node.Content[0].Kind != yaml.MappingNode {
			continue
		}
		mapping := node.Content[0]
		kind := scalarOf(mapping, "kind")
		apiVersion := scalarOf(mapping, "apiVersion")
		if kind == "" || apiVersion == "" {
			continue
		}
		if secretKinds[kind] || childOf(mapping, "stringData") != nil {
			continue
		}
		if kind == "Kustomization" {
			// Its resources are files under the same root, which the walk
			// already reads; its patches are documents of their own, folded
			// by kind and name with what they patch.
			continue
		}
		var body map[string]any
		if err := mapping.Decode(&body); err != nil {
			return out, err
		}
		meta, _ := body["metadata"].(map[string]any)
		o := object{
			file:       file,
			apiVersion: apiVersion,
			kind:       kind,
			name:       stringAt(meta, "name"),
			namespace:  stringAt(meta, "namespace"),
			labels:     stringMapAt(meta, "labels"),
			body:       body,
		}
		if o.name == "" {
			continue
		}
		out = append(out, o)
	}
}

func rel(root, p string) string {
	r, err := filepath.Rel(root, p)
	if err != nil {
		return filepath.ToSlash(p)
	}
	return filepath.ToSlash(r)
}

func childOf(mapping *yaml.Node, key string) *yaml.Node {
	if mapping == nil || mapping.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			return mapping.Content[i+1]
		}
	}
	return nil
}

func scalarOf(mapping *yaml.Node, key string) string {
	child := childOf(mapping, key)
	if child == nil || child.Kind != yaml.ScalarNode {
		return ""
	}
	return strings.TrimSpace(child.Value)
}

// The generic readers below walk decoded bodies. A field that is not the
// shape the API says is treated as absent: a manifest wrong in that way is
// the cluster's problem to reject, not this reader's to guess at.

func mapAt(m map[string]any, key string) map[string]any {
	if m == nil {
		return nil
	}
	child, _ := m[key].(map[string]any)
	return child
}

func listAt(m map[string]any, key string) []map[string]any {
	if m == nil {
		return nil
	}
	items, _ := m[key].([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if entry, ok := item.(map[string]any); ok {
			out = append(out, entry)
		}
	}
	return out
}

func stringAt(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	switch v := m[key].(type) {
	case string:
		return strings.TrimSpace(v)
	case int, int64, float64, bool:
		return strings.TrimSpace(strings.Trim(yamlScalar(v), "\n"))
	}
	return ""
}

func stringListAt(m map[string]any, key string) []string {
	if m == nil {
		return nil
	}
	items, _ := m[key].([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, strings.TrimSpace(s))
		}
	}
	return out
}

func stringMapAt(m map[string]any, key string) map[string]string {
	child := mapAt(m, key)
	if child == nil {
		return nil
	}
	out := make(map[string]string, len(child))
	for k, v := range child {
		if s, ok := v.(string); ok {
			out[k] = s
		} else if v != nil {
			out[k] = strings.TrimSpace(strings.Trim(yamlScalar(v), "\n"))
		}
	}
	return out
}

func yamlScalar(v any) string {
	raw, err := yaml.Marshal(v)
	if err != nil {
		return ""
	}
	return string(raw)
}
