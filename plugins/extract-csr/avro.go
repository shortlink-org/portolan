package main

// Avro, read for the two things the catalog keeps: what a record is called and
// what fields it has.
//
// This is deliberately not an Avro implementation. It never resolves a schema
// against data, never checks compatibility and never validates - a registry
// has already done all three, and a second opinion here is only a way for the
// two to disagree. It reads names and shapes, and renders every type as the
// short label a person reads on a page.

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// avro reads one .avsc into the shapes it declares.
//
// The first return is the full name of the record at the top, which is the
// name a message on the bus goes by. The rest are every named record inside
// it, keyed by full name, because a nested record is a shape shared by
// whatever else names it and `defs` is where a shared shape lives.
func avro(raw []byte) (string, map[string]catalog.TypeDef, error) {
	var node any
	if err := json.Unmarshal(raw, &node); err != nil {
		return "", nil, fmt.Errorf("not an Avro schema: %w", err)
	}

	r := &avroReader{defs: map[string]catalog.TypeDef{}}
	label, _ := r.typeOf(node, "")

	// A top-level union or array is legal Avro and names no record. The label
	// is still the honest answer to "what is this called".
	return label, r.defs, nil
}

type avroReader struct {
	defs map[string]catalog.TypeDef

	// open guards a record that names itself inside itself - a comment thread,
	// a tree - which is ordinary Avro and an infinite recursion here.
	open map[string]bool
}

// typeOf renders one Avro type, and returns the defs key when it is a record
// this reader has written down.
//
// enclosing is the namespace inherited from the schema this type sits in,
// which is how Avro spells a nested name: a record with no namespace of its
// own belongs to its parent's.
func (r *avroReader) typeOf(node any, enclosing string) (label, ref string) {
	switch value := node.(type) {
	case string:
		// A bare name is either a primitive or a reference to a shape named
		// earlier - possibly in another subject entirely, which is what a
		// registry reference is for. The reference is claimed here and cleared
		// later if nothing in the estate turns out to declare it, because only
		// the whole step can say whether the other subject was vendored too.
		name := qualify(value, enclosing)
		if primitive(value) {
			return name, ""
		}

		return name, name

	case []any:
		return r.union(value, enclosing), ""

	case map[string]any:
		return r.object(value, enclosing)
	}

	return "", ""
}

// union renders ["null", "string"] as "string?" - the shape a reader wants,
// rather than the shape the file has.
func (r *avroReader) union(members []any, enclosing string) string {
	var (
		labels   []string
		nullable bool
	)

	for _, member := range members {
		if name, isString := member.(string); isString && name == "null" {
			nullable = true

			continue
		}
		label, _ := r.typeOf(member, enclosing)
		labels = append(labels, label)
	}

	switch {
	case len(labels) == 0:
		return "null"
	case nullable:
		return strings.Join(labels, "|") + "?"
	}

	return strings.Join(labels, "|")
}

func (r *avroReader) object(node map[string]any, enclosing string) (label, ref string) {
	// A logical type is what the field MEANS, and it is what belongs on a
	// page: "timestamp-millis" says more than the "long" underneath it.
	if logical, _ := node["logicalType"].(string); logical != "" {
		return decorate(logical, node), ""
	}

	kind, _ := node["type"].(string)
	namespace := firstNonEmpty(text(node["namespace"]), enclosing)

	switch kind {
	case "record", "error":
		return r.record(node, namespace)

	case "enum", "fixed":
		// Named, but not a shape with fields, so there is nothing to put in
		// defs and the label is the whole answer.
		return qualify(text(node["name"]), namespace), ""

	case "array":
		items, _ := r.typeOf(node["items"], namespace)

		return items + "[]", ""

	case "map":
		values, _ := r.typeOf(node["values"], namespace)

		return "map<string, " + values + ">", ""

	case "":
		// `{"type": {...}}` with the real type one level down, which is how a
		// field wraps a schema it wants to annotate.
		if nested, wrapped := node["type"]; wrapped {
			return r.typeOf(nested, namespace)
		}

		return "", ""
	}

	return kind, ""
}

func (r *avroReader) record(node map[string]any, namespace string) (label, ref string) {
	name := qualify(text(node["name"]), namespace)
	if name == "" {
		return "", ""
	}

	if r.open[name] {
		// Already being read further up the stack: the name is the answer, and
		// the def it points at is written by the frame that opened it.
		return name, name
	}
	if _, written := r.defs[name]; written {
		return name, name
	}

	if r.open == nil {
		r.open = map[string]bool{}
	}
	r.open[name] = true
	defer delete(r.open, name)

	// The namespace a nested record inherits is this record's, not the one it
	// was reached from.
	inner := namespace
	if own := text(node["namespace"]); own != "" {
		inner = own
	} else if at := strings.LastIndex(name, "."); at > 0 {
		inner = name[:at]
	}

	fields := []catalog.Field{}
	for _, entry := range list(node["fields"]) {
		field, isObject := entry.(map[string]any)
		if !isObject {
			continue
		}
		fieldName := text(field["name"])
		if fieldName == "" {
			continue
		}
		fieldLabel, fieldRef := r.typeOf(field["type"], inner)
		fields = append(fields, catalog.Field{
			Name: fieldName,
			Type: fieldLabel,
			Doc:  text(field["doc"]),
			Ref:  fieldRef,
		})
	}

	r.defs[name] = catalog.TypeDef{Fields: fields}

	return name, name
}

// decorate spells out the parameters a logical type carries, because
// "decimal" without them is not a type anybody can act on.
func decorate(logical string, node map[string]any) string {
	if logical != "decimal" {
		return logical
	}

	precision, hasPrecision := number(node["precision"])
	if !hasPrecision {
		return logical
	}
	scale, hasScale := number(node["scale"])
	if !hasScale {
		scale = 0
	}

	return fmt.Sprintf("decimal(%d,%d)", precision, scale)
}

// qualify gives a name its namespace, unless it already carries one or is a
// primitive - which is the one rule that keeps "string" from becoming
// "shop.oms.string".
func qualify(name, namespace string) string {
	if name == "" || namespace == "" || strings.Contains(name, ".") || primitive(name) {
		return name
	}

	return namespace + "." + name
}

func primitive(name string) bool {
	switch name {
	case "null", "boolean", "int", "long", "float", "double", "bytes", "string":
		return true
	}

	return false
}

func text(node any) string {
	value, _ := node.(string)

	return strings.TrimSpace(value)
}

func list(node any) []any {
	values, _ := node.([]any)

	return values
}

func number(node any) (int, bool) {
	value, isNumber := node.(float64)

	return int(value), isNumber
}
