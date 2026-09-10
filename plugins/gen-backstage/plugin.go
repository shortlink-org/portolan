package genbackstage

import (
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"gopkg.in/yaml.v3"
)

type Options struct {
	Domain        string `json:"domain,omitempty"`
	DomainTitle   string `json:"domainTitle,omitempty"`
	Owner         string `json:"owner,omitempty"`
	Lifecycle     string `json:"lifecycle,omitempty"`
	SourceBaseURL string `json:"sourceBaseUrl,omitempty"`
}

type entity struct {
	APIVersion string         `yaml:"apiVersion"`
	Kind       string         `yaml:"kind"`
	Metadata   metadata       `yaml:"metadata"`
	Spec       map[string]any `yaml:"spec"`
}

type metadata struct {
	Name        string            `yaml:"name"`
	Title       string            `yaml:"title,omitempty"`
	Description string            `yaml:"description,omitempty"`
	Annotations map[string]string `yaml:"annotations,omitempty"`
	Tags        []string          `yaml:"tags,omitempty"`
	Links       []link            `yaml:"links,omitempty"`
}

// link is one of Backstage's entity links, the card on the entity page
// that takes a reader somewhere. `type` is Backstage's own free-text
// category; every link here is a command.
type link struct {
	URL   string `yaml:"url"`
	Title string `yaml:"title,omitempty"`
	Type  string `yaml:"type,omitempty"`
}

func render(req plugin.Request, opts Options) (plugin.Response, error) {
	if opts.Domain == "" {
		opts.Domain = "architecture"
	}
	if opts.DomainTitle == "" {
		opts.DomainTitle = "Architecture"
	}
	if opts.Owner == "" {
		opts.Owner = "architecture"
	}
	if opts.Lifecycle == "" {
		opts.Lifecycle = "production"
	}

	domain := entityFor("Domain", opts.Domain, opts.DomainTitle, "Architecture catalog exported by Portolan", "portolan.domain")
	domain.Spec = map[string]any{"owner": opts.Owner}
	entities := []entity{domain}

	contexts := append([]catalog.BoundedContext(nil), req.Catalog.Contexts...)
	sort.Slice(contexts, func(i, j int) bool { return contexts[i].ID < contexts[j].ID })
	apiName := map[string]string{}
	serviceName := map[string]string{}
	for i := range contexts {
		for j := range contexts[i].Services {
			svc := &contexts[i].Services[j]
			serviceName[svc.ID] = nameOf(svc.ID)
			for k := range svc.Provides {
				apiName[svc.Provides[k].ID] = nameOf(svc.Provides[k].ID)
			}
		}
	}
	for i := range req.Catalog.Externals {
		serviceName[req.Catalog.Externals[i].ID] = nameOf(req.Catalog.Externals[i].ID)
		for j := range req.Catalog.Externals[i].Provides {
			apiName[req.Catalog.Externals[i].Provides[j].ID] = nameOf(req.Catalog.Externals[i].Provides[j].ID)
		}
	}

	externals := append([]catalog.External(nil), req.Catalog.Externals...)
	sort.Slice(externals, func(i, j int) bool { return externals[i].ID < externals[j].ID })
	for i := range externals {
		ext := &externals[i]
		component := entityFor("Component", ext.ID, ext.Name, ext.Summary, ext.ID)
		provides := make([]string, 0, len(ext.Provides))
		for j := range ext.Provides {
			provides = append(provides, "api:default/"+nameOf(ext.Provides[j].ID))
		}
		component.Spec = compact(map[string]any{
			"type": "external-service", "lifecycle": opts.Lifecycle,
			"owner": opts.Owner, "providesApis": sortedUnique(provides),
		})
		entities = append(entities, component)
		for j := range ext.Provides {
			api := entityFor("API", ext.Provides[j].ID, ext.Provides[j].ID, "Interface provided by "+ext.Name, ext.Provides[j].ID)
			definition, err := json.MarshalIndent(map[string]any{"id": ext.Provides[j].ID, "methods": ext.Provides[j].Methods, "messages": ext.Provides[j].Messages}, "", "  ")
			if err != nil {
				return plugin.Response{}, err
			}
			api.Spec = map[string]any{"type": "portolan", "lifecycle": opts.Lifecycle, "owner": opts.Owner, "definition": string(definition)}
			entities = append(entities, api)
		}
	}

	for i := range contexts {
		ctx := &contexts[i]
		system := entityFor("System", ctx.ID, ctx.Name, ctx.Summary, ctx.ID)
		system.Spec = map[string]any{"owner": opts.Owner, "domain": nameOf(opts.Domain)}
		entities = append(entities, system)

		services := append([]catalog.Service(nil), ctx.Services...)
		sort.Slice(services, func(i, j int) bool { return services[i].ID < services[j].ID })
		for j := range services {
			svc := &services[j]
			owner := ownerOf(svc, opts.Owner)
			component := entityFor("Component", svc.ID, svc.Name, firstLine(svc.Readme), svc.ID)
			component.Metadata.Annotations = annotations(opts.SourceBaseURL, svc.ID, svc.Path, svc.Repo, true)
			component.Metadata.Tags = backstageTags(svc.Technologies)
			commands(&component.Metadata, svc, opts.SourceBaseURL)
			reachability(&component.Metadata, svc)
			depends := []string{}
			consumes := []string{}
			for _, call := range svc.Consumes {
				if peer := serviceName[call.Peer]; peer != "" {
					depends = append(depends, "component:default/"+peer)
				}
				if api := apiName[interfaceOf(call.ID)]; api != "" {
					consumes = append(consumes, "api:default/"+api)
				}
			}
			for _, store := range svc.Stores {
				depends = append(depends, "resource:default/"+nameOf(store))
			}
			for _, module := range svc.Modules {
				depends = append(depends, "resource:default/"+nameOf(module))
			}
			provides := make([]string, 0, len(svc.Provides))
			for _, provided := range svc.Provides {
				provides = append(provides, "api:default/"+nameOf(provided.ID))
			}
			component.Spec = compact(map[string]any{
				"type": componentType(svc.Kind), "lifecycle": opts.Lifecycle, "owner": owner,
				"system": nameOf(ctx.ID), "dependsOn": sortedUnique(depends),
				"providesApis": sortedUnique(provides), "consumesApis": sortedUnique(consumes),
			})
			entities = append(entities, component)
			for k := range svc.Provides {
				api, err := apiEntity(req, &svc.Provides[k], svc, ctx, opts)
				if err != nil {
					return plugin.Response{}, err
				}
				entities = append(entities, api)
			}
		}
	}

	stores := append([]catalog.Store(nil), req.Catalog.Stores...)
	sort.Slice(stores, func(i, j int) bool { return stores[i].ID < stores[j].ID })
	for i := range stores {
		store := &stores[i]
		resource := entityFor("Resource", store.ID, store.Name, "State owned by "+store.Owner, store.ID)
		resource.Metadata.Annotations = annotations(opts.SourceBaseURL, store.ID, store.Source, repoOf(req.Catalog, store.Owner), sourceIsDirectory(store.Source))
		resource.Spec = compact(map[string]any{"type": string(store.Kind), "owner": ownerForID(req.Catalog, store.Owner, opts.Owner), "system": systemFor(req.Catalog, store.Owner)})
		entities = append(entities, resource)
	}

	modules := append([]catalog.ProtoModule(nil), req.Catalog.Modules...)
	sort.Slice(modules, func(i, j int) bool { return modules[i].ID < modules[j].ID })
	for i := range modules {
		module := &modules[i]
		resource := entityFor("Resource", module.ID, module.Name, "Schema module "+module.ID, module.ID)
		resource.Metadata.Annotations = annotations(opts.SourceBaseURL, module.ID, module.Source, repoOf(req.Catalog, module.Owner), sourceIsDirectory(module.Source))
		resource.Spec = compact(map[string]any{"type": "schema-module", "owner": ownerForID(req.Catalog, module.Owner, opts.Owner), "system": systemFor(req.Catalog, module.Owner)})
		entities = append(entities, resource)
	}

	documents := make([]string, 0, len(entities))
	for i := range entities {
		if err := validateEntity(entities[i], entities); err != nil {
			return plugin.Response{}, err
		}
		raw, err := yaml.Marshal(entities[i])
		if err != nil {
			return plugin.Response{}, fmt.Errorf("backstage entity %s: %w", entities[i].Metadata.Name, err)
		}
		documents = append(documents, strings.TrimSpace(string(raw)))
	}
	return plugin.Response{Files: []plugin.File{{Name: "catalog-info.yaml", Contents: strings.Join(documents, "\n---\n") + "\n"}}}, nil
}

func componentType(kind catalog.ComponentKind) string {
	switch kind {
	case catalog.ComponentKindWebapp:
		return "website"
	case catalog.ComponentKindLibrary:
		return "library"
	case catalog.ComponentKindCLI:
		return "tool"
	case catalog.ComponentKindDataPipeline:
		return "data-pipeline"
	case catalog.ComponentKindApplication:
		return "application"
	case catalog.ComponentKindWorker:
		return "worker"
	case catalog.ComponentKindJob:
		return "job"
	case catalog.ComponentKindFunction:
		return "function"
	default:
		return "service"
	}
}

func backstageTags(technologies []string) []string {
	tags := make([]string, 0, len(technologies))
	for _, technology := range technologies {
		if tag := nameOf(technology); tag != "" {
			tags = append(tags, tag)
		}
	}
	return sortedUnique(tags)
}

func apiEntity(req plugin.Request, rpc *catalog.RpcService, svc *catalog.Service, ctx *catalog.BoundedContext, opts Options) (entity, error) {
	definition, err := json.MarshalIndent(map[string]any{"id": rpc.ID, "module": rpc.Module, "methods": rpc.Methods, "messages": rpc.Messages}, "", "  ")
	if err != nil {
		return entity{}, err
	}
	api := entityFor("API", rpc.ID, rpc.ID, "Interface provided by "+svc.Name, rpc.ID)
	api.Metadata.Annotations = annotations(opts.SourceBaseURL, rpc.ID, sourceWithin(svc.Path, rpc.Source), svc.Repo, false)
	// The definition is Portolan's normalized contract, not the original
	// OpenAPI/proto document. Calling it openapi or grpc would make Backstage
	// feed valid JSON to the wrong renderer.
	api.Spec = compact(map[string]any{"type": "portolan", "lifecycle": opts.Lifecycle, "owner": ownerOf(svc, opts.Owner), "system": nameOf(ctx.ID), "definition": string(definition)})
	return api, nil
}

func entityFor(kind, id, title, description, portolanID string) entity {
	return entity{APIVersion: "backstage.io/v1alpha1", Kind: kind, Metadata: metadata{Name: nameOf(id), Title: title, Description: strings.TrimSpace(description), Annotations: map[string]string{"portolan.io/id": portolanID}}, Spec: map[string]any{}}
}

func annotations(sourceBase, id, source, repo string, directory bool) map[string]string {
	out := map[string]string{"portolan.io/id": id}
	if url := sourceURL(sourceBase, source, repo, directory, false); url != "" {
		out["backstage.io/source-location"] = "url:" + url
	}
	return out
}

// sourceURL is where `source` is on the forge, when the source base names
// the same repository - or "" when the catalog cannot say. A `:line` suffix
// is dropped, or kept as the `#L` anchor both forges read, when asked.
func sourceURL(sourceBase, source, repo string, directory, keepLine bool) string {
	if sourceBase == "" || !sameRepo(repo, sourceBaseRepo(sourceBase)) {
		return ""
	}
	path := strings.TrimPrefix(strings.TrimSpace(source), "/")
	line := ""
	if at := strings.LastIndex(path, ":"); at > 0 {
		if keepLine {
			line = "#L" + path[at+1:]
		}
		path = path[:at]
	}
	if path == "" {
		return ""
	}
	base := strings.TrimSuffix(sourceBase, "/")
	if directory {
		base = strings.Replace(base, "/-/blob/", "/-/tree/", 1)
		base = strings.Replace(base, "/blob/", "/tree/", 1)
	}
	return base + "/" + path + line
}

// commands puts what a developer types onto the component, twice, because
// Backstage has no field for it. The annotation is the list itself, one
// command a line with its description, for anything that reads the entity;
// the links are the same commands as the Links card draws them, each
// leading to the line of the runner file it was read from, for the reader
// on the entity page. Links need a URL, so they exist only when the source
// base says where the repository is.
func commands(meta *metadata, svc *catalog.Service, sourceBase string) {
	if len(svc.Commands) == 0 {
		return
	}
	lines := make([]string, 0, len(svc.Commands))
	for _, cmd := range svc.Commands {
		line := cmd.Run
		if cmd.Doc != "" {
			line += " — " + cmd.Doc
		}
		lines = append(lines, line)
		if url := sourceURL(sourceBase, cmd.Source, svc.Repo, false, true); url != "" {
			meta.Links = append(meta.Links, link{URL: url, Title: line, Type: "command"})
		}
	}
	meta.Annotations["portolan.io/commands"] = strings.Join(lines, "\n")
}

func sourceBaseRepo(base string) string {
	for _, marker := range []string{"/-/blob/", "/-/tree/", "/blob/", "/tree/"} {
		if at := strings.Index(base, marker); at >= 0 {
			return base[:at]
		}
	}
	return base
}

func nameOf(value string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(value) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
			dash = false
		} else if b.Len() > 0 && !dash {
			b.WriteByte('-')
			dash = true
		}
	}
	name := strings.Trim(b.String(), "-")
	if name == "" {
		return "portolan-entity"
	}
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}

func sourceWithin(root, source string) string {
	root = strings.Trim(strings.TrimSpace(root), "/")
	source = strings.TrimPrefix(strings.TrimSpace(source), "/")
	if root == "" || source == "" || source == root || strings.HasPrefix(source, root+"/") {
		return source
	}
	return path.Join(root, source)
}

func sourceIsDirectory(source string) bool {
	source = strings.TrimSuffix(strings.TrimSpace(source), "/")
	if at := strings.LastIndex(source, ":"); at > 0 {
		source = source[:at]
	}
	return path.Ext(source) == ""
}

func validateEntity(current entity, all []entity) error {
	seen := map[string]bool{}
	for _, candidate := range all {
		key := strings.ToLower(candidate.Kind) + ":default/" + candidate.Metadata.Name
		if seen[key] {
			return fmt.Errorf("duplicate Backstage entity %s", key)
		}
		seen[key] = true
	}

	check := func(field string, refs []string) error {
		for _, ref := range refs {
			if !seen[strings.ToLower(ref)] {
				return fmt.Errorf("backstage entity %s/%s has unresolved %s reference %q", current.Kind, current.Metadata.Name, field, ref)
			}
		}
		return nil
	}
	for _, field := range []string{"dependsOn", "providesApis", "consumesApis"} {
		if refs, ok := current.Spec[field].([]string); ok {
			if err := check(field, refs); err != nil {
				return err
			}
		}
	}
	if value, ok := current.Spec["system"].(string); ok && value != "" {
		if err := check("system", []string{"system:default/" + value}); err != nil {
			return err
		}
	}
	if value, ok := current.Spec["domain"].(string); ok && value != "" {
		if err := check("domain", []string{"domain:default/" + value}); err != nil {
			return err
		}
	}
	return nil
}

// reachability puts where the service answers and what it dials onto the
// component, as annotations, for anything that reads the entity. Names and
// nothing else, which is all the catalog holds of them.
func reachability(meta *metadata, svc *catalog.Service) {
	if len(svc.Hosts) > 0 {
		meta.Annotations["portolan.io/hosts"] = strings.Join(svc.Hosts, ", ")
	}
	if len(svc.Dials) > 0 {
		meta.Annotations["portolan.io/dials"] = strings.Join(svc.Dials, ", ")
	}
}

func ownerOf(service *catalog.Service, fallback string) string {
	if len(service.Owners) == 0 {
		return fallback
	}
	return strings.TrimPrefix(service.Owners[0], "@")
}

func ownerForID(cat catalog.Catalog, id, fallback string) string {
	for i := range cat.Contexts {
		for j := range cat.Contexts[i].Services {
			if cat.Contexts[i].Services[j].ID == id {
				return ownerOf(&cat.Contexts[i].Services[j], fallback)
			}
		}
	}
	return fallback
}
func systemFor(cat catalog.Catalog, service string) string {
	for i := range cat.Contexts {
		for j := range cat.Contexts[i].Services {
			if cat.Contexts[i].Services[j].ID == service {
				return nameOf(cat.Contexts[i].ID)
			}
		}
	}
	return ""
}
func repoOf(cat catalog.Catalog, service string) string {
	for i := range cat.Contexts {
		for j := range cat.Contexts[i].Services {
			if cat.Contexts[i].Services[j].ID == service {
				return cat.Contexts[i].Services[j].Repo
			}
		}
	}
	return ""
}
func interfaceOf(call string) string {
	if at := strings.LastIndex(call, "/"); at > 0 {
		return call[:at]
	}
	return call
}
func sameRepo(a, b string) bool {
	clean := func(v string) string {
		return strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(v, "https://"), "http://"), ".git"), "/"))
	}
	return a == "" || clean(a) == clean(b)
}
func firstLine(value string) string {
	if at := strings.Index(value, "\n"); at >= 0 {
		value = value[:at]
	}
	return strings.TrimSpace(strings.TrimPrefix(value, "# "))
}
func sortedUnique(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}
func compact(values map[string]any) map[string]any {
	for key, value := range values {
		switch v := value.(type) {
		case string:
			if v == "" {
				delete(values, key)
			}
		case []string:
			if len(v) == 0 {
				delete(values, key)
			}
		}
	}
	return values
}
