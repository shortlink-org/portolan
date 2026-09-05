// Package openapi is what two extractors agree on about an OpenAPI document:
// how its interfaces are named in the catalog, and which operation answers on
// which route. The server side reads the document to say what a service
// provides; the client side reads the copy vendored beside a generated client
// to say what a service calls. Both have to spell `auth.v1.Sessions/login` the
// same way, or the call would never resolve to the method, and one place is
// how they do.
package openapi

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// APIID is the document's title and major version: `auth` 1.0.0 gives
// `auth.v1`. It prefixes every interface the document declares.
func APIID(title, version string) string {
	name := title
	if name == "" {
		name = "api"
	}
	name = strings.ReplaceAll(strings.ToLower(name), " ", "-")

	if major, _, ok := strings.Cut(version, "."); ok && major != "" {
		return name + ".v" + major
	}

	return name
}

// DocumentAPIID is the id a document says it goes by in the estate, or the one
// built from its title and version when it says nothing.
//
// `x-portolan-api` in `info` is for a copy vendored from outside the estate:
// Stripe's document is titled "Stripe API" and versioned "2026-08-26.dahlia",
// and `stripe-api.v2026-08-26` on every arrow would be the document's words
// where the estate wants its own. The copy is the consumer's translation
// boundary already, so it is the one place the estate's name may be written,
// and both sides of a call read it from there rather than from two manifests.
func DocumentAPIID(declared, title, version string) string {
	if declared = strings.TrimSpace(declared); declared != "" {
		return declared
	}

	return APIID(title, version)
}

// Title is the human form of a tag: users becomes Users, price_list becomes
// PriceList, because it sits in an id beside a proto-shaped service name.
func Title(name string) string {
	var b strings.Builder
	for _, word := range strings.FieldsFunc(name, func(r rune) bool { return r == '_' || r == '-' || r == ' ' }) {
		runes := []rune(word)
		if runes[0] >= 'a' && runes[0] <= 'z' {
			runes[0] = runes[0] - 'a' + 'A'
		}
		b.WriteString(string(runes))
	}

	return b.String()
}

// InterfaceID is the interface an operation belongs to: the api and the
// operation's first tag, or the api alone for an operation with none.
func InterfaceID(api, tag string) string {
	if tag == "" {
		return api
	}

	return api + "." + Title(tag)
}

// Verbs, in the order the paths object lists them by convention.
var Verbs = []string{"get", "put", "post", "delete", "options", "head", "patch", "trace"}

// Operation is one route of the document and the name it goes by.
type Operation struct {
	// ID is the operationId, or `VERB /path` when the document has none.
	ID string
	// Tag is the first tag, which decides the interface.
	Tag string
	// Verb is upper case: POST.
	Verb string
	// Path is the template as written: /v1/users/{userId}.
	Path string
}

// Interface is the id of the interface the operation belongs to.
func (o Operation) Interface(api string) string { return InterfaceID(api, o.Tag) }

// CallID is what a call to this operation is known by in the catalog.
func (o Operation) CallID(api string) string { return o.Interface(api) + "/" + o.ID }

// Spec is the part of a document these extractors read.
type Spec struct {
	API        string
	Operations []Operation
}

// Read loads a document and lists its operations. The api id may be
// overridden by whoever calls, since the manifest may name one.
func Read(path string) (*Spec, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var root yaml.Node
	if err := yaml.Unmarshal(contents, &root); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	node := &root
	if node.Kind == yaml.DocumentNode && len(node.Content) > 0 {
		node = node.Content[0]
	}

	info := child(node, "info")
	spec := &Spec{API: DocumentAPIID(text(child(info, "x-portolan-api")), text(child(info, "title")), text(child(info, "version")))}
	for _, p := range entries(child(node, "paths")) {
		for _, verb := range Verbs {
			operation := child(p.value, verb)
			if operation == nil {
				continue
			}
			id := text(child(operation, "operationId"))
			if id == "" {
				id = strings.ToUpper(verb) + " " + p.key
			}
			tags := list(child(operation, "tags"))
			tag := ""
			if len(tags) > 0 {
				tag = tags[0]
			}
			spec.Operations = append(spec.Operations, Operation{ID: id, Tag: tag, Verb: strings.ToUpper(verb), Path: p.key})
		}
	}

	return spec, nil
}

// Find looks up an operation by verb and route. Both sides may spell a path
// parameter differently - `{userId}` in the document, `%s` in a generated
// client - so parameters are compared by position, not by name.
func (s *Spec) Find(verb, path string) (Operation, bool) {
	want := strings.ToUpper(verb) + " " + shape(path)
	for _, op := range s.Operations {
		if op.Verb+" "+shape(op.Path) == want {
			return op, true
		}
	}

	return Operation{}, false
}

// shape replaces every parameter, however spelled, with one marker.
func shape(path string) string {
	var b strings.Builder
	for _, segment := range strings.Split(strings.TrimSuffix(path, "/"), "/") {
		if strings.HasPrefix(segment, "{") || segment == "%s" || segment == "%v" || segment == "%d" {
			b.WriteString("/*")

			continue
		}
		b.WriteString("/" + segment)
	}

	return b.String()
}

type entry struct {
	key   string
	value *yaml.Node
}

func entries(node *yaml.Node) []entry {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	var out []entry
	for i := 0; i+1 < len(node.Content); i += 2 {
		out = append(out, entry{key: node.Content[i].Value, value: node.Content[i+1]})
	}

	return out
}

func child(node *yaml.Node, keys ...string) *yaml.Node {
	for _, key := range keys {
		if node == nil || node.Kind != yaml.MappingNode {
			return nil
		}
		var next *yaml.Node
		for i := 0; i+1 < len(node.Content); i += 2 {
			if node.Content[i].Value == key {
				next = node.Content[i+1]

				break
			}
		}
		node = next
	}

	return node
}

func text(node *yaml.Node) string {
	if node == nil || node.Kind != yaml.ScalarNode {
		return ""
	}

	return strings.TrimSpace(node.Value)
}

func list(node *yaml.Node) []string {
	if node == nil || node.Kind != yaml.SequenceNode {
		return nil
	}
	var out []string
	for _, item := range node.Content {
		out = append(out, text(item))
	}

	return out
}
