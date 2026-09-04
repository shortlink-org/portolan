package main

import (
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// The document is read as a node tree rather than into structs, for the reason
// the OpenAPI extractor gives beside its own reader: a mapping unmarshalled
// into a Go map loses the order its author wrote, and a channel object holds
// keys this does not model, which walking the nodes ignores rather than fails
// on.
//
// Two versions have to be read here, and they disagree about a word. In 3.x an
// operation says `action: send` or `action: receive`, from the application's
// side, and that is the end of it. In 2.x a channel has `publish` and
// `subscribe`, and both are written from the *client's* side: `publish` is what
// somebody else publishes to the application, and `subscribe` is what the
// application produces for somebody else to subscribe to. Reading 2.x the
// obvious way gets every arrow backwards, which is the confusion 3.x was
// changed to end.

type document struct {
	root *yaml.Node
	path string
	// major is the major version of the document: 2 or 3.
	major int
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

	node := &root
	if node.Kind == yaml.DocumentNode && len(node.Content) > 0 {
		node = node.Content[0]
	}

	doc := &document{root: node, path: path, major: 3}
	if version := text(child(node, "asyncapi")); strings.HasPrefix(version, "2.") {
		doc.major = 2
	}

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

// items reads a sequence, or the single node written where a sequence was
// allowed. A document that names one message where it could have named several
// is the common case, and both spellings mean the same thing.
func items(node *yaml.Node) []*yaml.Node {
	if node == nil {
		return nil
	}
	if node.Kind != yaml.SequenceNode {
		return []*yaml.Node{node}
	}

	return node.Content
}

// deref follows a local $ref, and answers the node itself when there is none.
//
// Only local refs are followed. A document that reaches into another file is
// describing something this extractor cannot see, and guessing at a name from
// the last segment of a path would be inventing one.
func (d *document) deref(node *yaml.Node) (*yaml.Node, string) {
	ref := text(child(node, "$ref"))
	if ref == "" {
		return node, ""
	}
	if !strings.HasPrefix(ref, "#/") {
		return nil, ref
	}

	var keys []string
	for _, segment := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
		// JSON Pointer escapes, which a channel address containing a slash
		// needs: `shop~1cart` is one key, not two.
		segment = strings.ReplaceAll(segment, "~1", "/")
		keys = append(keys, strings.ReplaceAll(segment, "~0", "~"))
	}

	return child(d.root, keys...), ref
}

// refKey is the last segment of a ref, which is the key the thing it points at
// is filed under.
func refKey(ref string) string {
	at := strings.LastIndex(ref, "/")
	if at < 0 {
		return ref
	}

	return strings.ReplaceAll(strings.ReplaceAll(ref[at+1:], "~1", "/"), "~0", "~")
}
