package extractopenapi

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

	// Whose document this is: a service of the estate, or a system outside it
	// whose copy is vendored beside the adapter that calls it. The two are told
	// apart by the manifest and by nothing in the document, because a document
	// does not know which side of the boundary it was read on.
	external := opts.External != ""
	if external && strings.Contains(opts.External, ".") {
		return plugin.Response{}, fmt.Errorf("external %q has a dot in its id; an external sits at the root and is addressed by a bare name", opts.External)
	}
	if !external {
		if opts.Context == "" {
			opts.Context = filepath.Base(root)
		}
		if opts.Service == "" {
			opts.Service = filepath.Base(root)
		}
	}
	owner := opts.Context + "." + opts.Service
	if external {
		owner = opts.External
	}

	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{},
		Defs:     map[string]catalog.TypeDef{},
		Flows:    []catalog.Flow{},
		Adrs:     []catalog.Adr{},
	}

	var provides []catalog.RpcService
	var externals []catalog.External
	if opts.Spec == "" && !external {
		// Nothing named: the tree says which documents it implements and
		// which it calls.
		provides, externals = discover(root, owner, opts, b)
	} else {
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

		provides = rpcServices(doc, api, source, b)
		if len(provides) == 0 {
			b.Warn(owner, source+" declares no operations")
		}
	}
	if provides == nil {
		provides = []catalog.RpcService{}
	}

	if external {
		// Everything the catalog may claim about a system it does not own: what
		// it answers on, and what the manifest says it is called and is for.
		fragment.Externals = []catalog.External{{
			ID:       opts.External,
			Slug:     opts.External,
			Name:     opts.ExternalName,
			Summary:  opts.ExternalSummary,
			URL:      opts.ExternalURL,
			Provides: provides,
		}}
	} else {
		fragment.Contexts = []catalog.BoundedContext{{
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
		}}
		if len(externals) > 0 {
			fragment.Externals = externals
		}
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}

	b.File(firstNonEmpty(opts.Out, "api.json"), string(encoded)+"\n")

	return b.Response(), nil
}

// rpcServices turns one OpenAPI document into one provided HTTP API.
//
// Tags organise operations inside a document; they do not declare independent
// contracts. Treating every tag as an interface repeats shared schemas in every
// tag card and makes one specification look like many APIs.
func rpcServices(doc *document, api, source string, b *plugin.Builder) []catalog.RpcService {
	methods := []catalog.RpcMethod{}
	schemas := []schemaRef{}
	seen := map[string]bool{}
	visited := map[string]bool{}
	unnamed := []string{}

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
				unnamed = append(unnamed, method)
			}

			// The name, the route, and the shapes on either side. The
			// document names the last two whenever the body is a $ref, which
			// is what lets a flow draw what comes back from a call and not
			// only that one was made.
			request, response := doc.shapes(p.value, operation)
			methods = append(methods, catalog.RpcMethod{
				Name:     method,
				Request:  request,
				Response: response,
				HTTP:     &catalog.HttpRoute{Method: strings.ToUpper(verb), Path: p.key},
			})
			doc.schemaRefs(operation, &schemas, seen, visited)
		}
	}

	if len(methods) == 0 {
		return []catalog.RpcService{}
	}
	warnUnnamed(b, api, len(methods), unnamed)

	return []catalog.RpcService{{
		ID:       openapi.InterfaceID(api, ""),
		Methods:  methods,
		Source:   source,
		Messages: messages(doc, schemas, seen, visited, b),
	}}
}

// unnamedShown is how many nameless routes the warning spells out before it
// counts the rest.
const unnamedShown = 5

// warnUnnamed says once per contract which operations the document left
// without an operationId. A document missing fifty ids is one limitation of
// that document, not fifty; a reader fixing it wants the count and enough
// routes to find the pattern, and a check run wants one line, not a page.
func warnUnnamed(b *plugin.Builder, api string, total int, unnamed []string) {
	if len(unnamed) == 0 {
		return
	}
	shown := unnamed
	rest := ""
	if len(shown) > unnamedShown {
		shown = shown[:unnamedShown]
		rest = fmt.Sprintf(" and %d more", len(unnamed)-unnamedShown)
	}
	b.Warn(api, fmt.Sprintf("no operationId on %d of %d operations; listed by verb and path: %s%s",
		len(unnamed), total, strings.Join(shown, ", "), rest))
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
	if name, ok := refName(ref); ok {
		return name
	}
	return ""
}

// schemaFields is the shape as the catalog carries it. Which fields must be
// sent is the first thing a caller needs, and it is the field's own flag;
// a field the document does not list as required carries nothing, which is
// what the document means.
func schemaFields(doc *document, node *yaml.Node) []catalog.Field {
	fields, required := schemaShape(doc, node, map[string]bool{})
	for i := range fields {
		fields[i].Required = required[fields[i].Name]
	}
	return fields
}

// A JSON Schema keyword and the catalog's word for it. `format` is not here:
// it is part of the type already, `string (uuid)`. `enum` likewise.
var schemaRules = []struct{ keyword, rule string }{
	{"const", "const"},
	{"minLength", "min_len"},
	{"maxLength", "max_len"},
	{"pattern", "pattern"},
	{"minimum", "gte"},
	{"maximum", "lte"},
	{"exclusiveMinimum", "gt"},
	{"exclusiveMaximum", "lt"},
	{"multipleOf", "multiple_of"},
	{"minItems", "min_items"},
	{"maxItems", "max_items"},
	{"uniqueItems", "unique"},
	{"minProperties", "min_pairs"},
	{"maxProperties", "max_pairs"},
}

// rulesOf reads the validation keywords of a property into rules, in the
// order the keywords are listed above. A property that is a `$ref` carries
// the target's keywords, since that is where the author put them; what an
// array holds is read one level down under `items.`.
func rulesOf(doc *document, node *yaml.Node) []catalog.FieldRule {
	if ref := text(child(node, "$ref")); ref != "" {
		if targetDoc, target, _, ok := doc.resolve(ref); ok {
			doc, node = targetDoc, target
		}
	}

	var rules []catalog.FieldRule
	for _, r := range schemaRules {
		value := text(child(node, r.keyword))
		if value == "" {
			continue
		}
		switch r.keyword {
		case "uniqueItems":
			if value != "true" {
				continue
			}
			value = ""
		case "exclusiveMinimum", "exclusiveMaximum":
			// OpenAPI 3.0 spells these as a bool beside the bound; the bound is
			// then strict, and the flag on its own says nothing.
			if value == "true" || value == "false" {
				if value == "true" {
					rules = strictBound(rules, r.rule)
				}

				continue
			}
		}
		rules = append(rules, catalog.FieldRule{Name: r.rule, Value: value})
	}
	if items := child(node, "items"); items != nil {
		for _, rule := range rulesOf(doc, items) {
			rules = append(rules, catalog.FieldRule{Name: "items." + rule.Name, Value: rule.Value})
		}
	}

	return rules
}

// strictBound turns the `gte` already read into `gt` (or `lte` into `lt`)
// when the 3.0-style exclusive flag says the bound is not included.
func strictBound(rules []catalog.FieldRule, strict string) []catalog.FieldRule {
	inclusive := strict + "e"
	for i := range rules {
		if rules[i].Name == inclusive {
			rules[i].Name = strict
		}
	}

	return rules
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
		fields = append(fields, catalog.Field{
			Name:  property.key,
			Type:  typeOf(doc, property.value),
			Doc:   text(child(property.value, "description")),
			Rules: rulesOf(doc, property.value),
		})
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
		if name, ok := refName(ref); ok {
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

	return openapi.DocumentAPIID(text(child(info, "x-portolan-api")), text(child(info, "title")), text(child(info, "version")))
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
