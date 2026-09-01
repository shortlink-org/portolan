package main

import (
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// The document is read as a node tree rather than into structs.
//
// Two reasons, and both are about the reader of the output. A YAML mapping
// unmarshalled into a Go map loses its order, and the order paths and schemas
// are written in is the author's - alphabetising it would be a worse document
// than the one they wrote. And a path item holds keys that are not verbs, and a
// schema holds keywords this does not model; walking the nodes means ignoring
// them rather than failing on them.

// verbs, in the order a reader expects to meet them rather than the order they
// happen to appear.
var verbs = []string{"get", "post", "put", "patch", "delete", "head", "options", "trace"}

type document struct {
	root *yaml.Node
	path string
}

func load(path string) (*document, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var root yaml.Node
	if err := yaml.Unmarshal(contents, &root); err != nil {
		return nil, err
	}

	// A document node wraps the mapping.
	node := &root
	if node.Kind == yaml.DocumentNode && len(node.Content) > 0 {
		node = node.Content[0]
	}

	return &document{root: node, path: path}, nil
}

// entry is one key/value pair of a mapping, in document order.
type entry struct {
	key   string
	value *yaml.Node
}

func entries(node *yaml.Node) []entry {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}

	out := make([]entry, 0, len(node.Content)/2)
	for i := 0; i+1 < len(node.Content); i += 2 {
		out = append(out, entry{key: node.Content[i].Value, value: node.Content[i+1]})
	}

	return out
}

// child follows a path of mapping keys, and answers nil for anything missing.
func child(node *yaml.Node, keys ...string) *yaml.Node {
	for _, key := range keys {
		found := false
		for _, e := range entries(node) {
			if e.key == key {
				node = e.value
				found = true

				break
			}
		}
		if !found {
			return nil
		}
	}

	return node
}

func text(node *yaml.Node) string {
	if node == nil {
		return ""
	}

	return strings.TrimSpace(node.Value)
}

func list(node *yaml.Node) []string {
	if node == nil || node.Kind != yaml.SequenceNode {
		return nil
	}

	out := make([]string, 0, len(node.Content))
	for _, item := range node.Content {
		out = append(out, item.Value)
	}

	return out
}

const (
	schemaRefPrefix = "#/components/schemas/"
	componentPrefix = "#/components/"
)

// schemaRefs collects every component schema a subtree names, in the order they
// are met.
//
// A $ref that points at another component - a shared response, a parameter - is
// followed rather than ignored, because that is how a spec says "the same error
// body as everywhere else", and a reader who is not shown it is being told this
// endpoint returns nothing on failure.
func (d *document) schemaRefs(node *yaml.Node, into *[]string, seen, visited map[string]bool) {
	if node == nil {
		return
	}

	switch node.Kind {
	case yaml.MappingNode:
		for _, e := range entries(node) {
			if e.key != "$ref" {
				d.schemaRefs(e.value, into, seen, visited)

				continue
			}

			ref := text(e.value)
			if name, ok := strings.CutPrefix(ref, schemaRefPrefix); ok {
				if !seen[name] {
					seen[name] = true
					*into = append(*into, name)
				}

				continue
			}

			// Some other component. Follow it once.
			if !strings.HasPrefix(ref, componentPrefix) || visited[ref] {
				continue
			}
			visited[ref] = true
			d.schemaRefs(child(d.root, strings.Split(strings.TrimPrefix(ref, "#/"), "/")...), into, seen, visited)
		}
	case yaml.SequenceNode:
		for _, item := range node.Content {
			d.schemaRefs(item, into, seen, visited)
		}
	}
}
