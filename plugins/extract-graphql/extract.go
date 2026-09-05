package main

// The schema in, the interfaces a service provides out.
//
// A GraphQL schema says three things a catalog wants: what a client may ask
// for, what comes back, and which of those answers keep arriving. The first
// two are what every other interface in this estate already carries - methods
// with a request and a response - and the third is what `Streaming` is for: a
// subscription is a server stream, and drawing it as a call would be a lie
// about how the two ends are coupled.
//
// What it deliberately does not say is who answers underneath. A BFF's whole
// job is to fan out to other services, and the schema is silent about that on
// purpose - the resolvers know, and the extractor that reads the resolvers is
// the one that reports the calls.

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// operations are the three root operation types, in the order a reader meets
// them: ask, change, keep listening.
var operations = []string{"query", "mutation", "subscription"}

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	root := in.Root

	if opts.Context == "" {
		opts.Context = filepath.Base(root)
	}
	if opts.Service == "" {
		opts.Service = filepath.Base(root)
	}
	api := opts.API
	if api == "" {
		api = opts.Service + ".v1"
	}

	files, err := findSchema(root, opts.Schema)
	if err != nil {
		return plugin.Response{}, err
	}

	doc := newDocument()
	for _, file := range files {
		source, err := os.ReadFile(file)
		if err != nil {
			return plugin.Response{}, err
		}
		if err := parseInto(doc, string(source), filepath.ToSlash(file), moduleOf(root, file)); err != nil {
			return plugin.Response{}, err
		}
	}

	provides := rpcServices(doc, api, b)
	if len(provides) == 0 {
		b.Warn(opts.Context+"."+opts.Service, strings.Join(relAll(files), ", ")+" declares no root fields; nothing answers over this schema")
	}

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts: []catalog.BoundedContext{{
			ID:   opts.Context,
			Slug: opts.Context,
			// Named by whichever source knows the name. A schema says what the
			// service answers, not what the service is called.
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

	b.File(firstNonEmpty(opts.Out, "graphql.json"), string(encoded)+"\n")

	return b.Response(), nil
}

// rpcServices groups the root fields by the module that declared them.
//
// A tag is how an OpenAPI author says "these endpoints belong together"; a
// schema module - one directory, one `schema.graphql` - is how a GraphQL
// author says it, and it has the advantage of being a file, so the interface
// can point at something a reader can open. A schema written in one file has
// one group, named by the api itself, exactly as an untagged document is.
func rpcServices(doc *document, api string, b *plugin.Builder) []catalog.RpcService {
	type group struct {
		methods []catalog.RpcMethod
		// extra are the argument shapes invented for this interface. Nobody
		// declared them, so they are carried here rather than looked up.
		extra  []catalog.RpcMessage
		queue  []string
		seen   map[string]bool
		source string
	}

	groups := map[string]*group{}
	var order []string

	for _, operation := range operations {
		rootName := doc.root(operation)
		rootType := doc.types[rootName]
		if rootType == nil {
			continue
		}

		for _, field := range rootType.fields {
			id := interfaceID(api, field.module)
			g, ok := groups[id]
			if !ok {
				g = &group{seen: map[string]bool{}, source: field.file}
				groups[id] = g
				order = append(order, id)
			}
			if g.source != field.file {
				// One module, two files. The interface can only point at one
				// of them, and a reader following it to the wrong half would
				// not know it had.
				b.Warn(id, "root fields come from both "+g.source+" and "+field.file+"; the interface points at the first")
			}

			method := catalog.RpcMethod{
				Name:       methodName(rootName, field.name),
				Doc:        field.doc,
				Response:   field.typ.name,
				Deprecated: field.deprecated,
			}
			if field.deprecated && field.reason != "" {
				method.Doc = strings.TrimSpace(method.Doc + "\n\nDeprecated: " + field.reason)
			}
			if operation == "subscription" {
				method.Streaming = catalog.StreamingServer
			}

			request, invented := requestOf(doc, rootName, field)
			method.Request = request
			if invented != nil {
				g.extra = append(g.extra, *invented)
			} else {
				enqueue(doc, g.seen, &g.queue, request)
			}
			for _, arg := range field.args {
				enqueue(doc, g.seen, &g.queue, arg.typ.name)
			}
			enqueue(doc, g.seen, &g.queue, field.typ.name)

			g.methods = append(g.methods, method)
		}
	}

	sort.Strings(order)

	out := make([]catalog.RpcService, 0, len(order))
	for _, id := range order {
		g := groups[id]
		out = append(out, catalog.RpcService{
			ID:       id,
			Methods:  g.methods,
			Source:   g.source,
			Messages: append(g.extra, messages(doc, g.seen, g.queue)...),
		})
	}

	return out
}

// requestOf names what a field is given.
//
// A field whose whole input is one input object is already named by the
// schema, and inventing a second name for it would be noise. A field with
// loose arguments has no name for them, so one is made and the arguments
// become its fields.
func requestOf(doc *document, rootName string, field fieldDef) (string, *catalog.RpcMessage) {
	if len(field.args) == 0 {
		return "", nil
	}
	if len(field.args) == 1 {
		if t := doc.types[field.args[0].typ.name]; t != nil && t.kind == kindInput && !field.args[0].typ.list {
			return t.name, nil
		}
	}

	message := catalog.RpcMessage{Name: argsMessage(rootName, field.name)}
	for _, arg := range field.args {
		message.Fields = append(message.Fields, catalog.Field{
			Name: arg.name,
			Type: spell(doc, arg.typ),
			Doc:  optional(arg.doc, arg.typ),
		})
	}

	return message.Name, &message
}

func enqueue(doc *document, seen map[string]bool, queue *[]string, name string) {
	t := doc.types[name]
	if t == nil || seen[name] {
		return
	}
	switch t.kind {
	case kindObject, kindInput, kindInterface, kindUnion:
		seen[name] = true
		*queue = append(*queue, name)
	}
}

// messages turns every type the group's fields reach into a named shape.
//
// The list grows while it is walked - a response names a type, that type names
// another - for the same reason the OpenAPI extractor's does: a reader who has
// to follow three links to find out what came back has been given a worse
// document than the schema.
func messages(doc *document, seen map[string]bool, queue []string) []catalog.RpcMessage {
	out := []catalog.RpcMessage{}

	for i := 0; i < len(queue); i++ {
		t := doc.types[queue[i]]
		if t == nil {
			continue
		}

		message := catalog.RpcMessage{Name: t.name, Fields: []catalog.Field{}}
		for _, field := range t.fields {
			prose := optional(field.doc, field.typ)
			if field.deprecated {
				prose = strings.TrimSpace(prose + "\n\nDeprecated: " + field.reason)
			}
			message.Fields = append(message.Fields, catalog.Field{
				Name: field.name,
				Type: spell(doc, field.typ),
				Doc:  prose,
			})
			enqueue(doc, seen, &queue, field.typ.name)
			for _, arg := range field.args {
				enqueue(doc, seen, &queue, arg.typ.name)
			}
		}
		if d := discriminator(doc, t); d != nil {
			message.Discriminator = d
			for _, variant := range d.Variants {
				enqueue(doc, seen, &queue, variant.Message)
			}
		}
		out = append(out, message)
	}

	return out
}

// discriminator is how a polymorphic answer says which shape it is. GraphQL
// has one answer for both of its ways of being polymorphic, and it is the same
// field a client would select: `__typename`.
func discriminator(doc *document, t *typeDef) *catalog.RpcDiscriminator {
	var members []string
	switch t.kind {
	case kindUnion:
		members = t.members
	case kindInterface:
		for _, name := range doc.order {
			other := doc.types[name]
			if other.kind == kindObject && contains(other.implements, t.name) {
				members = append(members, other.name)
			}
		}
	}
	if len(members) == 0 {
		return nil
	}

	variants := make([]catalog.RpcVariant, 0, len(members))
	for _, member := range members {
		variants = append(variants, catalog.RpcVariant{Value: member, Message: member})
	}

	return &catalog.RpcDiscriminator{Property: "__typename", Variants: variants}
}

// spell renders a field's type. An enum carries its values along with its
// name, the way an OpenAPI enum does, because a status whose values are three
// clicks away is a status nobody reads.
func spell(doc *document, ref typeRef) string {
	spelled := ref.spell()
	if t := doc.types[ref.name]; t != nil && t.kind == kindEnum && len(t.values) > 0 {
		spelled += " enum(" + strings.Join(t.values, " | ") + ")"
	}

	return spelled
}

// optional says in prose what `!` says in the schema, because that is where
// the rest of the catalog says it.
func optional(doc string, ref typeRef) string {
	if ref.nonNull {
		return doc
	}

	return strings.TrimSpace("Optional. " + doc)
}

// findSchema locates the documents. Told where they are - a file or a
// directory - it reads there; otherwise it searches, because a service with
// its schema in the conventional place should not have to say so.
func findSchema(root, declared string) ([]string, error) {
	if declared != "" {
		at := filepath.Join(root, filepath.FromSlash(declared))
		info, err := os.Stat(at)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			return []string{at}, nil
		}

		return walkSchema(at)
	}

	found, err := walkSchema(root)
	if err != nil {
		return nil, err
	}
	if len(found) == 0 {
		return nil, fmt.Errorf("no graphql schema under %s, and none named in the options", root)
	}

	return found, nil
}

func walkSchema(dir string) ([]string, error) {
	var found []string
	err := filepath.WalkDir(dir, func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			switch entry.Name() {
			case "node_modules", "dist", "vendor", ".git":
				return filepath.SkipDir
			}

			return nil
		}
		switch filepath.Ext(entry.Name()) {
		case ".graphql", ".graphqls", ".gql":
			// The generator writes the whole schema out again beside the
			// modules it read - `schema.generated.graphqls` - and reading that
			// copy would give the estate a module nobody wrote, holding every
			// field twice.
			if !strings.Contains(entry.Name(), ".generated.") {
				found = append(found, p)
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(found)

	return found, nil
}

// moduleOf is what a file is called for the purpose of grouping. A schema
// written as `basket/schema.graphql` is the basket module; one written as
// `basket.graphql` is the same module said another way.
func moduleOf(root, file string) string {
	rel, err := filepath.Rel(root, file)
	if err != nil {
		rel = file
	}
	name := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(rel))
	if name != "schema" && name != "index" {
		return name
	}

	parent := filepath.Base(filepath.Dir(rel))
	if parent == "." || parent == string(filepath.Separator) {
		return ""
	}

	return parent
}

func relAll(files []string) []string {
	out := make([]string, 0, len(files))
	for _, file := range files {
		out = append(out, filepath.ToSlash(file))
	}

	return out
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}

	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}
