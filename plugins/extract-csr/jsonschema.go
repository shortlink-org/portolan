package main

// JSON Schema, read for the same two things Avro is read for.
//
// The one thing that has to be careful here is ORDER. An Avro record lists its
// fields in an array, so reading them into Go keeps the order the author wrote
// them in. A JSON Schema lists them as the keys of an object, and decoding an
// object into a map loses that order - which would put the fields on the page
// in a different arrangement every run and rewrite the fragment each time. So
// the properties are walked with a token decoder instead.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// jsonSchema reads one .json into the shapes it declares, the same way avro
// does: the name of the shape at the top, and every named shape inside it.
//
// fallback names the top-level shape when the document does not name itself,
// which most of them do not: a JSON Schema's `title` is optional and a
// registered one usually leans on the subject to say what it is.
func jsonSchema(raw []byte, fallback string) (string, map[string]catalog.TypeDef, error) {
	var node jsonNode
	if err := json.Unmarshal(raw, &node); err != nil {
		return "", nil, fmt.Errorf("not a JSON Schema: %w", err)
	}

	name := firstNonEmpty(node.Title, fallback)
	r := &jsonReader{defs: map[string]catalog.TypeDef{}, prefix: name}

	// The named shapes a document keeps to one side are read first, so a `$ref`
	// pointing at one resolves to a def rather than to a bare label.
	//
	// They are filed under the document's own name. `definitions` is local to
	// the document by definition, and `defs` in the catalog is not: two
	// services that both keep a "Carrier" to one side, meaning different
	// things, would otherwise collide in the merge and be reported as a
	// disagreement neither of them is having.
	for _, held := range []map[string]json.RawMessage{node.Definitions, node.Defs} {
		for _, key := range keysInOrder(held) {
			var nested jsonNode
			if err := json.Unmarshal(held[key], &nested); err != nil {
				continue
			}
			r.shape(nested, r.qualify(key))
		}
	}

	r.shape(node, name)

	return name, r.defs, nil
}

// jsonNode is the part of a JSON Schema this reads. Everything it leaves out -
// every keyword that constrains a value rather than naming or shaping it - is
// the registry's business, not the catalog's.
type jsonNode struct {
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Type        json.RawMessage `json:"type"`
	Format      string          `json:"format"`
	Ref         string          `json:"$ref"`
	Items       *jsonNode       `json:"items"`
	Required    []string        `json:"required"`
	OneOf       []jsonNode      `json:"oneOf"`
	AnyOf       []jsonNode      `json:"anyOf"`

	Properties  json.RawMessage            `json:"properties"`
	Definitions map[string]json.RawMessage `json:"definitions"`
	Defs        map[string]json.RawMessage `json:"$defs"`
}

type jsonReader struct {
	defs map[string]catalog.TypeDef
	open map[string]bool

	// prefix is the document's own shape name, which is what makes a
	// document-local definition globally addressable.
	prefix string
}

// qualify files a document-local name under the document.
func (r *jsonReader) qualify(name string) string {
	if r.prefix == "" || name == "" {
		return name
	}

	return r.prefix + "." + name
}

// declared says whether a shape is one this reader wrote down, including one
// still being read further up the stack.
func (r *jsonReader) declared(name string) bool {
	if r.open[name] {
		return true
	}
	_, written := r.defs[name]

	return written
}

// shape writes down one object's fields, under the name given, and returns
// whether it wrote anything. A schema with no properties is not a shape.
func (r *jsonReader) shape(node jsonNode, name string) bool {
	if name == "" || len(node.Properties) == 0 {
		return false
	}
	if r.open[name] {
		return true
	}
	if _, written := r.defs[name]; written {
		return true
	}

	if r.open == nil {
		r.open = map[string]bool{}
	}
	r.open[name] = true
	defer delete(r.open, name)

	required := map[string]bool{}
	for _, key := range node.Required {
		required[key] = true
	}

	// Written before the fields are read, so a schema that names itself inside
	// itself finds an entry rather than recursing forever.
	r.defs[name] = catalog.TypeDef{Fields: []catalog.Field{}}

	fields := []catalog.Field{}
	for _, key := range propertiesInOrder(node.Properties) {
		var property jsonNode
		if err := json.Unmarshal(key.value, &property); err != nil {
			continue
		}

		label, ref := r.typeOf(property, name+"."+key.name)
		if !required[key.name] && !strings.HasSuffix(label, "?") {
			label += "?"
		}

		fields = append(fields, catalog.Field{
			Name: key.name,
			Type: label,
			Doc:  strings.TrimSpace(property.Description),
			Ref:  ref,
		})
	}

	r.defs[name] = catalog.TypeDef{Fields: fields}

	return true
}

// typeOf renders one property, and returns the defs key when it is an object
// this reader wrote down.
//
// path is what an anonymous nested object is called: a schema that inlines an
// address under `shipping` has named it, just not with a `title`, and
// "OrderPlaced.shipping" is the name it gave it.
func (r *jsonReader) typeOf(node jsonNode, path string) (label, ref string) {
	if node.Ref != "" {
		// The label stays the name the document uses - "Carrier" is what a
		// reader of the schema sees - while the ref carries the qualified key
		// the catalog files it under. The two are allowed to differ, and here
		// they have to.
		name := refName(node.Ref)
		if key := r.qualify(name); r.declared(key) {
			return name, key
		}

		return name, ""
	}

	if members := append(append([]jsonNode{}, node.OneOf...), node.AnyOf...); len(members) > 0 {
		return r.choice(members, path), ""
	}

	kinds, nullable := typeNames(node.Type)

	if node.Items != nil {
		items, _ := r.typeOf(*node.Items, path)

		return suffix(items+"[]", nullable), ""
	}

	if len(node.Properties) > 0 {
		name := firstNonEmpty(node.Title, path)
		if r.shape(node, name) {
			return suffix(name, nullable), name
		}
	}

	// A format says what the string MEANS, and it is what belongs on a page:
	// "date-time" says more than the "string" underneath it.
	if node.Format != "" {
		return suffix(node.Format, nullable), ""
	}
	if len(kinds) == 0 {
		return suffix(firstNonEmpty(node.Title, "any"), nullable), ""
	}

	return suffix(strings.Join(kinds, "|"), nullable), ""
}

// choice renders oneOf/anyOf. A member that is only `{"type":"null"}` is the
// document saying the value is optional, which is a "?" rather than a member.
func (r *jsonReader) choice(members []jsonNode, path string) string {
	var (
		labels   []string
		nullable bool
	)

	for _, member := range members {
		kinds, memberNull := typeNames(member.Type)
		if memberNull || (len(kinds) == 1 && kinds[0] == "null") {
			nullable = true
			if len(kinds) <= 1 && member.Ref == "" && len(member.Properties) == 0 {
				continue
			}
		}

		label, _ := r.typeOf(member, path)
		labels = append(labels, strings.TrimSuffix(label, "?"))
	}

	if len(labels) == 0 {
		return "null"
	}

	return suffix(strings.Join(labels, "|"), nullable)
}

// typeNames reads `type`, which is either a string or an array of them, and
// pulls "null" out of the array into the nullability it actually means.
func typeNames(raw json.RawMessage) (kinds []string, nullable bool) {
	if len(raw) == 0 {
		return nil, false
	}

	var one string
	if json.Unmarshal(raw, &one) == nil {
		if one == "null" {
			return nil, true
		}

		return []string{one}, false
	}

	var many []string
	if json.Unmarshal(raw, &many) != nil {
		return nil, false
	}

	for _, kind := range many {
		if kind == "null" {
			nullable = true

			continue
		}
		kinds = append(kinds, kind)
	}

	return kinds, nullable
}

func suffix(label string, nullable bool) string {
	if nullable && !strings.HasSuffix(label, "?") {
		return label + "?"
	}

	return label
}

// refName is the last segment of a `$ref`, which is the name the definition is
// filed under. A `$ref` reaching outside the document names something this
// extractor has never seen, and the last segment is still the best label for
// it.
func refName(ref string) string {
	at := strings.LastIndex(ref, "/")
	if at < 0 {
		return ref
	}

	return ref[at+1:]
}

type property struct {
	name  string
	value json.RawMessage
}

// propertiesInOrder walks an object with a token decoder, which is the only
// way to keep the order its keys were written in.
func propertiesInOrder(raw json.RawMessage) []property {
	if len(raw) == 0 {
		return nil
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	if _, err := decoder.Token(); err != nil { // the opening brace
		return nil
	}

	var out []property
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return out
		}
		name, isString := key.(string)
		if !isString {
			return out
		}

		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return out
		}
		out = append(out, property{name: name, value: value})
	}

	return out
}

// keysInOrder is the same problem for `definitions`, which is decoded into a
// map because nothing about it is ordered on the page - only sorted, so the
// fragment comes out the same way every run.
func keysInOrder(held map[string]json.RawMessage) []string {
	names := make([]string, 0, len(held))
	for name := range held {
		names = append(names, name)
	}
	sort.Strings(names)

	return names
}
