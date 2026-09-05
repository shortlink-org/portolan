package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"github.com/shortlink-org/portolan/plugins/openapi"
	"gopkg.in/yaml.v3"
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	root := in.Root

	if opts.Context == "" {
		opts.Context = filepath.Base(root)
	}
	if opts.Service == "" {
		opts.Service = filepath.Base(root)
	}

	specPath, err := findSpec(root, opts.Spec, b)
	if err != nil {
		return plugin.Response{}, err
	}

	doc, err := load(specPath)
	if err != nil {
		return plugin.Response{}, fmt.Errorf("%s: %w", specPath, err)
	}

	source := filepath.ToSlash(specPath)
	api := firstNonEmpty(opts.API, apiID(doc))

	provides := rpcServices(doc, api, source, b)
	if len(provides) == 0 {
		b.Warn(opts.Context+"."+opts.Service, source+" declares no operations")
	}

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts: []catalog.BoundedContext{{
			ID:   opts.Context,
			Slug: opts.Context,
			// Named by whichever source knows the name. This one describes what
			// the service answers, not what it is called, and a fragment that
			// filled these in from an API title would be inventing.
			Services: []catalog.Service{{
				ID:         opts.Context + "." + opts.Service,
				Slug:       opts.Service,
				Provides:   provides,
				Consumes:   []catalog.RpcCall{},
				Aggregates: []catalog.Aggregate{},
			}},
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{},
		Adrs:  []catalog.Adr{},
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}

	b.File(firstNonEmpty(opts.Out, "api.json"), string(encoded)+"\n")

	return b.Response(), nil
}

// rpcServices groups the document's operations by tag.
//
// A tag is what an OpenAPI author uses to say "these endpoints belong
// together", which is the same thing a proto service says, so the two map onto
// each other without inventing anything. Untagged operations are collected
// under the api id itself rather than into a group called "other".
func rpcServices(doc *document, api, source string, b *plugin.Builder) []catalog.RpcService {
	type group struct {
		methods []catalog.RpcMethod
		schemas []schemaRef
		seen    map[string]bool
		visited map[string]bool
	}

	groups := map[string]*group{}
	var order []string

	for _, p := range entries(child(doc.root, "paths")) {
		for _, verb := range verbs {
			operation := child(p.value, verb)
			if operation == nil {
				continue
			}

			method := text(child(operation, "operationId"))
			if method == "" {
				// Falling back rather than skipping: an operation with no id is
				// still an endpoint, and a reader looking for it wants to find
				// it under something.
				method = strings.ToUpper(verb) + " " + p.key
				b.Warn(api, p.key+" "+strings.ToUpper(verb)+" has no operationId; listed by verb and path")
			}

			tags := list(child(operation, "tags"))
			tag := ""
			if len(tags) > 0 {
				tag = tags[0]
			}

			id := openapi.InterfaceID(api, tag)

			g, ok := groups[id]
			if !ok {
				g = &group{seen: map[string]bool{}, visited: map[string]bool{}}
				groups[id] = g
				order = append(order, id)
			}
			// The name, the route, and the shapes on either side. The
			// document names the last two whenever the body is a $ref, which
			// is what lets a flow draw what comes back from a call and not
			// only that one was made.
			request, response := doc.shapes(operation)
			g.methods = append(g.methods, catalog.RpcMethod{
				Name:     method,
				Request:  request,
				Response: response,
				HTTP:     &catalog.HttpRoute{Method: strings.ToUpper(verb), Path: p.key},
			})
			doc.schemaRefs(operation, &g.schemas, g.seen, g.visited)
		}
	}

	out := make([]catalog.RpcService, 0, len(order))
	for _, id := range order {
		g := groups[id]

		out = append(out, catalog.RpcService{
			ID:       id,
			Methods:  g.methods,
			Source:   source,
			Messages: messages(doc, g.schemas, g.seen, g.visited, b),
		})
	}

	return out
}

// messages turns every schema the group's operations reach into a named shape.
//
// The list grows while it is walked: a request body names a schema, that schema
// names another, and a reader who has to follow three links to find out what
// comes back has been given a worse document than the yaml.
func messages(doc *document, refs []schemaRef, seen, visited map[string]bool, b *plugin.Builder) []catalog.RpcMessage {
	out := []catalog.RpcMessage{}
	for i := 0; i < len(refs); i++ {
		ref := refs[i]
		// Anything this schema refers to joins the queue behind it.
		ref.doc.schemaRefs(ref.node, &refs, seen, visited)

		out = append(out, catalog.RpcMessage{
			Name:          ref.name,
			Fields:        schemaFields(ref.doc, ref.node),
			Discriminator: schemaDiscriminator(ref.doc, ref.node),
		})
	}

	return out
}

func schemaDiscriminator(doc *document, node *yaml.Node) *catalog.RpcDiscriminator {
	return discriminatorIn(doc, node, map[string]bool{})
}

func discriminatorIn(doc *document, node *yaml.Node, resolving map[string]bool) *catalog.RpcDiscriminator {
	if node == nil {
		return nil
	}
	if ref := text(child(node, "$ref")); ref != "" {
		if targetDoc, target, pointer, ok := doc.resolve(ref); ok {
			key := targetDoc.path + "#" + pointer
			if !resolving[key] {
				resolving[key] = true
				found := discriminatorIn(targetDoc, target, resolving)
				delete(resolving, key)
				if found != nil {
					return found
				}
			}
		}
	}

	discriminator := child(node, "discriminator")
	property := text(child(discriminator, "propertyName"))
	if property != "" {
		byMessage := map[string][]string{}
		var mapped []catalog.RpcVariant
		for _, entry := range entries(child(discriminator, "mapping")) {
			if message := schemaMessageName(doc, text(entry.value)); message != "" {
				byMessage[message] = append(byMessage[message], entry.key)
				mapped = append(mapped, catalog.RpcVariant{Value: entry.key, Message: message})
			}
		}

		var variants []catalog.RpcVariant
		seen := map[string]bool{}
		appendVariant := func(variant catalog.RpcVariant) {
			key := variant.Value + "\x00" + variant.Message
			if !seen[key] {
				variants = append(variants, variant)
				seen[key] = true
			}
		}
		for _, keyword := range []string{"oneOf", "anyOf"} {
			for _, branch := range itemsOf(child(node, keyword)) {
				message := schemaMessageName(doc, text(child(branch, "$ref")))
				if message == "" {
					continue
				}
				values := byMessage[message]
				if len(values) == 0 {
					values = []string{message}
				}
				for _, value := range values {
					appendVariant(catalog.RpcVariant{Value: value, Message: message})
				}
			}
		}
		for _, variant := range mapped {
			appendVariant(variant)
		}
		return &catalog.RpcDiscriminator{Property: property, Variants: variants}
	}

	for _, branch := range itemsOf(child(node, "allOf")) {
		if found := discriminatorIn(doc, branch, resolving); found != nil {
			return found
		}
	}
	return nil
}

func schemaMessageName(doc *document, ref string) string {
	if ref == "" {
		return ""
	}
	if _, _, pointer, ok := doc.resolve(ref); ok {
		if name, schema := schemaName(pointer); schema {
			return name
		}
	}
	if name, ok := strings.CutPrefix(ref, schemaRefPrefix); ok {
		return name
	}
	return ""
}

func schemaFields(doc *document, node *yaml.Node) []catalog.Field {
	fields, required := schemaShape(doc, node, map[string]bool{})
	for i := range fields {
		if !required[fields[i].Name] {
			fields[i].Doc = strings.TrimSpace("Optional. " + fields[i].Doc)
		}
	}
	return fields
}

// schemaShape flattens object composition into the field model the catalog
// has. allOf contributes every required field; oneOf/anyOf contributes the
// union, with a field required only when every variant requires it.
func schemaShape(doc *document, node *yaml.Node, resolving map[string]bool) ([]catalog.Field, map[string]bool) {
	fields := []catalog.Field{}
	required := map[string]bool{}
	merge := func(more []catalog.Field, moreRequired map[string]bool, requireMode bool) {
		for _, field := range more {
			at := -1
			for i := range fields {
				if fields[i].Name == field.Name {
					at = i
					break
				}
			}
			if at < 0 {
				fields = append(fields, field)
			} else {
				if fields[at].Type != field.Type && field.Type != "" {
					fields[at].Type = unionTypes(fields[at].Type, field.Type)
				}
				if fields[at].Doc == "" {
					fields[at].Doc = field.Doc
				}
			}
			if requireMode && moreRequired[field.Name] {
				required[field.Name] = true
			}
		}
	}
	if ref := text(child(node, "$ref")); ref != "" {
		if targetDoc, target, pointer, ok := doc.resolve(ref); ok {
			key := targetDoc.path + "#" + pointer
			if !resolving[key] {
				resolving[key] = true
				more, moreRequired := schemaShape(targetDoc, target, resolving)
				delete(resolving, key)
				merge(more, moreRequired, true)
			}
		}
	}

	for _, name := range list(child(node, "required")) {
		required[name] = true
	}
	for _, property := range entries(child(node, "properties")) {
		fields = append(fields, catalog.Field{Name: property.key, Type: typeOf(doc, property.value), Doc: text(child(property.value, "description"))})
	}

	for _, branch := range itemsOf(child(node, "allOf")) {
		more, moreRequired := schemaShape(doc, branch, resolving)
		merge(more, moreRequired, true)
	}

	for _, keyword := range []string{"oneOf", "anyOf"} {
		variants := itemsOf(child(node, keyword))
		if len(variants) == 0 {
			continue
		}
		counts := map[string]int{}
		for _, branch := range variants {
			more, moreRequired := schemaShape(doc, branch, resolving)
			merge(more, moreRequired, false)
			for name := range moreRequired {
				counts[name]++
			}
		}
		for name, count := range counts {
			if count == len(variants) {
				required[name] = true
			}
		}
	}
	return fields, required
}

func itemsOf(node *yaml.Node) []*yaml.Node {
	if node == nil || node.Kind != yaml.SequenceNode {
		return nil
	}
	return node.Content
}

// typeOf renders composed schemas, enums, maps and OpenAPI 3.1 nullable type
// arrays while keeping the compact spelling used elsewhere in the catalog.
func typeOf(doc *document, node *yaml.Node) string {
	if ref := text(child(node, "$ref")); ref != "" {
		if _, _, pointer, ok := doc.resolve(ref); ok {
			if name, schema := schemaName(pointer); schema {
				return name
			}
		}
		if name, ok := strings.CutPrefix(ref, schemaRefPrefix); ok {
			return name
		}

		return ref
	}

	for _, keyword := range []string{"oneOf", "anyOf"} {
		var variants []string
		for _, branch := range itemsOf(child(node, keyword)) {
			variants = append(variants, typeOf(doc, branch))
		}
		if len(variants) > 0 {
			return nullableType(strings.Join(unique(variants), " | "), node)
		}
	}
	if branches := itemsOf(child(node, "allOf")); len(branches) > 0 {
		var variants []string
		for _, branch := range branches {
			variants = append(variants, typeOf(doc, branch))
		}
		return nullableType(strings.Join(unique(variants), " & "), node)
	}

	kind := text(child(node, "type"))
	if child(node, "type") != nil && child(node, "type").Kind == yaml.SequenceNode {
		kinds := unique(list(child(node, "type")))
		if format := text(child(node, "format")); format != "" {
			for i := range kinds {
				if kinds[i] != "null" {
					kinds[i] += " (" + format + ")"
				}
			}
		}
		kind = strings.Join(kinds, " | ")
		if values := list(child(node, "enum")); len(values) > 0 {
			kind += " enum(" + strings.Join(values, " | ") + ")"
		}
		return nullableType(kind, node)
	}
	if kind == "array" {
		return nullableType("[]"+typeOf(doc, child(node, "items")), node)
	}
	if kind == "object" {
		additional := child(node, "additionalProperties")
		if additional != nil && (additional.Kind == yaml.MappingNode || text(additional) == "true") {
			value := "any"
			if additional.Kind == yaml.MappingNode {
				value = typeOf(doc, additional)
			}
			return nullableType("map[string]"+value, node)
		}
	}

	if format := text(child(node, "format")); format != "" {
		kind += " (" + format + ")"
	}

	if kind == "" {
		kind = "object"
	}
	if values := list(child(node, "enum")); len(values) > 0 {
		kind += " enum(" + strings.Join(values, " | ") + ")"
	}
	return nullableType(kind, node)
}

func nullableType(kind string, node *yaml.Node) string {
	if text(child(node, "nullable")) == "true" && !strings.Contains(kind, "null") {
		return kind + " | null"
	}
	return kind
}

func unique(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func unionTypes(left, right string) string {
	return strings.Join(unique(append(strings.Split(left, " | "), strings.Split(right, " | ")...)), " | ")
}

// apiID is the document's title and major version: `auth` 1.0.0 gives
// `auth.v1`. Spelled by the package the client-side extractor shares, so a
// call and the method it lands on are named alike.
func apiID(doc *document) string {
	info := child(doc.root, "info")

	return openapi.APIID(text(child(info, "title")), text(child(info, "version")))
}

// findSpec locates the document. Told where it is, it looks there; otherwise it
// searches, and says what it found so a service with two specs does not get
// documented from whichever one sorted first without anybody noticing.
func findSpec(root, declared string, b *plugin.Builder) (string, error) {
	if declared != "" {
		return filepath.Join(root, filepath.FromSlash(declared)), nil
	}

	var found []string
	err := filepath.WalkDir(root, func(p string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		switch entry.Name() {
		case "openapi.yaml", "openapi.yml", "swagger.yaml", "swagger.yml":
			found = append(found, p)
		}

		return nil
	})
	if err != nil {
		return "", err
	}

	if len(found) == 0 {
		return "", fmt.Errorf("no openapi document under %s, and none named in the options", root)
	}
	if len(found) > 1 {
		b.Warn("", "found "+strings.Join(found, ", ")+"; reading the first and ignoring the rest")
	}

	return found[0], nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}
