package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
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
		schemas []string
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

			id := api
			if tag != "" {
				id = api + "." + title(tag)
			}

			g, ok := groups[id]
			if !ok {
				g = &group{seen: map[string]bool{}, visited: map[string]bool{}}
				groups[id] = g
				order = append(order, id)
			}
			// Only the name: this document says what the interface is called
			// and what it answers on, and it does not say which message goes
			// out or comes back in a form this extractor reads.
			g.methods = append(g.methods, catalog.RpcMethod{Name: method})
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
func messages(doc *document, names []string, seen, visited map[string]bool, b *plugin.Builder) []catalog.RpcMessage {
	schemas := child(doc.root, "components", "schemas")

	out := []catalog.RpcMessage{}
	for i := 0; i < len(names); i++ {
		name := names[i]

		node := child(schemas, name)
		if node == nil {
			b.Warn(name, "the document refers to schema "+name+", which it does not define")

			continue
		}

		// Anything this schema refers to joins the queue behind it.
		doc.schemaRefs(node, &names, seen, visited)

		out = append(out, catalog.RpcMessage{Name: name, Fields: schemaFields(node)})
	}

	return out
}

func schemaFields(node *yaml.Node) []catalog.Field {
	required := map[string]bool{}
	for _, name := range list(child(node, "required")) {
		required[name] = true
	}

	out := []catalog.Field{}
	for _, property := range entries(child(node, "properties")) {
		doc := text(child(property.value, "description"))
		if !required[property.key] {
			// Which fields must be sent is the first thing a caller needs and
			// the schema has nowhere else to put it.
			doc = strings.TrimSpace("Optional. " + doc)
		}

		out = append(out, catalog.Field{
			Name: property.key,
			Type: typeOf(property.value),
			Doc:  doc,
		})
	}

	return out
}

// typeOf renders a schema as a type a reader recognises: `string (email)`,
// `[]Session`, `User`.
func typeOf(node *yaml.Node) string {
	if ref := text(child(node, "$ref")); ref != "" {
		if name, ok := strings.CutPrefix(ref, schemaRefPrefix); ok {
			return name
		}

		return ref
	}

	kind := text(child(node, "type"))
	if kind == "array" {
		return "[]" + typeOf(child(node, "items"))
	}

	if format := text(child(node, "format")); format != "" {
		return kind + " (" + format + ")"
	}

	if kind == "" {
		return "object"
	}

	return kind
}

// apiID is the document's title and major version: `auth` 1.0.0 gives `auth.v1`.
func apiID(doc *document) string {
	info := child(doc.root, "info")

	name := text(child(info, "title"))
	if name == "" {
		name = "api"
	}
	name = strings.ReplaceAll(strings.ToLower(name), " ", "-")

	version := text(child(info, "version"))
	if major, _, ok := strings.Cut(version, "."); ok && major != "" {
		return name + ".v" + major
	}

	return name
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

// title is the human form of a tag: users becomes Users, price_list becomes
// PriceList, because it sits in an id beside a proto-shaped service name.
func title(name string) string {
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
