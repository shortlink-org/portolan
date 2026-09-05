package main

import (
	"os"
	"path/filepath"
	"strconv"
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
	root  *yaml.Node
	path  string
	cache map[string]*document
}

func load(path string) (*document, error) {
	cache := map[string]*document{}
	return loadCached(path, cache)
}

func loadCached(path string, cache map[string]*document) (*document, error) {
	path = filepath.Clean(path)
	if held := cache[path]; held != nil {
		return held, nil
	}
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

	doc := &document{root: node, path: path, cache: cache}
	cache[path] = doc
	return doc, nil
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
)

type schemaRef struct {
	doc  *document
	node *yaml.Node
	name string
	key  string
}

// schemaRefs collects every component schema a subtree names, in the order they
// are met.
//
// A $ref that points at another component - a shared response, a parameter - is
// followed rather than ignored, because that is how a spec says "the same error
// body as everywhere else", and a reader who is not shown it is being told this
// endpoint returns nothing on failure.
func (d *document) schemaRefs(node *yaml.Node, into *[]schemaRef, seen, visited map[string]bool) {
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
			targetDoc, target, pointer, ok := d.resolve(ref)
			if !ok {
				continue
			}
			key := targetDoc.path + "#" + pointer
			if name, schema := schemaName(pointer); schema {
				if !seen[key] {
					seen[key] = true
					*into = append(*into, schemaRef{doc: targetDoc, node: target, name: name, key: key})
				}
				continue
			}
			if visited[key] {
				continue
			}
			visited[key] = true
			targetDoc.schemaRefs(target, into, seen, visited)
		}
	case yaml.SequenceNode:
		for _, item := range node.Content {
			d.schemaRefs(item, into, seen, visited)
		}
	}
}

// shapes are what an operation sends and what it answers with, by the names the
// document gives them.
//
// A body behind a $ref has a name a reader can look up in Messages; an inline
// schema has none, and inventing one would put a shape in the catalog the
// document does not have. A success with no body at all is answered by its
// status: 204 is a real answer, and saying nothing for it reads as a call that
// never came back.
func (d *document) shapes(operation *yaml.Node) (string, string) {
	request := d.bodyName(child(operation, "requestBody"))

	code, body := "", (*yaml.Node)(nil)
	for _, e := range entries(child(operation, "responses")) {
		status, err := strconv.Atoi(e.key)
		if err != nil || status < 200 || status > 299 {
			continue
		}
		if code == "" || e.key < code {
			code, body = e.key, e.value
		}
	}
	if body == nil {
		return request, ""
	}
	if name := d.bodyName(body); name != "" {
		return request, name
	}

	return request, code
}

// bodyName is the component schema a request or response body names, following
// one $ref to a shared component on the way. A list of a schema is that schema
// with brackets: the message is the item, and the reader wants to see there are
// several.
func (d *document) bodyName(node *yaml.Node) string {
	bodyDoc, body := d.follow(node)
	for _, e := range entries(child(body, "content")) {
		mediaDoc, media := bodyDoc.follow(e.value)
		schema := child(media, "schema")
		if name := mediaDoc.schemaTypeName(schema); name != "" {
			return name
		}
	}

	return ""
}

func (d *document) schemaTypeName(node *yaml.Node) string {
	if _, _, pointer, ok := d.resolve(text(child(node, "$ref"))); ok {
		if name, schema := schemaName(pointer); schema {
			return name
		}
	}
	if text(child(node, "type")) == "array" {
		if name := d.schemaTypeName(child(node, "items")); name != "" {
			return name + "[]"
		}
	}
	for _, keyword := range []string{"oneOf", "anyOf"} {
		var names []string
		for _, branch := range itemsOf(child(node, keyword)) {
			if name := d.schemaTypeName(branch); name != "" {
				names = append(names, name)
			}
		}
		if len(names) > 0 {
			return strings.Join(unique(names), " | ")
		}
	}
	return ""
}

// follow resolves chains of local or relative-file component references.
func (d *document) follow(node *yaml.Node) (*document, *yaml.Node) {
	seen := map[string]bool{}
	for {
		ref := text(child(node, "$ref"))
		nextDoc, next, pointer, ok := d.resolve(ref)
		if !ok {
			return d, node
		}
		key := nextDoc.path + "#" + pointer
		if seen[key] {
			return d, node
		}
		seen[key] = true
		d, node = nextDoc, next
	}
}

// resolve follows JSON Pointer refs in this document or in a relative YAML/
// JSON file. Remote refs are intentionally not fetched by an extractor.
func (d *document) resolve(ref string) (*document, *yaml.Node, string, bool) {
	if ref == "" || strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
		return nil, nil, "", false
	}
	file, fragment, hasFragment := strings.Cut(ref, "#")
	if !hasFragment {
		return nil, nil, "", false
	}
	target := d
	if file != "" {
		loaded, err := loadCached(filepath.Join(filepath.Dir(d.path), filepath.FromSlash(file)), d.cache)
		if err != nil {
			return nil, nil, "", false
		}
		target = loaded
	}
	pointer := strings.TrimPrefix(fragment, "/")
	if pointer == "" {
		return target, target.root, pointer, true
	}
	parts := strings.Split(pointer, "/")
	for i := range parts {
		parts[i] = strings.ReplaceAll(strings.ReplaceAll(parts[i], "~1", "/"), "~0", "~")
	}
	node := child(target.root, parts...)
	return target, node, pointer, node != nil
}

func schemaName(pointer string) (string, bool) {
	const prefix = "components/schemas/"
	name, ok := strings.CutPrefix(pointer, prefix)
	if !ok || name == "" || strings.Contains(name, "/") {
		return "", false
	}
	return strings.ReplaceAll(strings.ReplaceAll(name, "~1", "/"), "~0", "~"), true
}
