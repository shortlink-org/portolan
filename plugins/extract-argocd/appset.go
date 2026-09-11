package extractargocd

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"text/template"

	"gopkg.in/yaml.v3"

	"github.com/shortlink-org/portolan/plugin"
)

// params is one row a generator produced: what the template is rendered
// with. Nested maps stay nested for a Go template (`{{.cluster.name}}`),
// and are flattened on the way into a fasttemplate one (`{{cluster.name}}`).
type params map[string]any

// expander holds what every generator of one ApplicationSet needs.
type expander struct {
	name       string // the ApplicationSet, for warnings
	repoRoot   string
	repo       string // the repository this tree is, "" when the manifest did not say
	goTemplate bool
	missingKey string
	b          *plugin.Builder
}

// expand turns one generator into its rows. A generator this reader cannot
// answer from a tree - a cluster, a forge, a plugin - is a warning naming
// the ApplicationSet and the generator, and no rows.
func (e *expander) expand(gen map[string]any, base params) []params {
	switch {
	case gen["list"] != nil:
		return e.expandList(sub(gen, "list"), base)
	case gen["git"] != nil:
		return e.expandGit(sub(gen, "git"), base)
	case gen["matrix"] != nil:
		return e.expandMatrix(sub(gen, "matrix"), base)
	case gen["merge"] != nil:
		e.b.Warn(e.name, "the merge generator is not read: its rows depend on how the controller merges, which a tree does not say")
	case gen["clusters"] != nil:
		e.b.Warn(e.name, "the cluster generator is not read: which clusters are registered is a fact of the control plane, not of the tree")
	case gen["pullRequest"] != nil, gen["scmProvider"] != nil:
		e.b.Warn(e.name, "the pull request and SCM provider generators are not read: they ask a forge")
	case gen["plugin"] != nil:
		e.b.Warn(e.name, "the plugin generator is not read: it runs code the tree does not hold")
	default:
		e.b.Warn(e.name, "a generator of an unknown kind is passed over")
	}
	return nil
}

func (e *expander) expandList(gen map[string]any, base params) []params {
	var rows []params
	for _, element := range list(gen, "elements") {
		fields, ok := element.(map[string]any)
		if !ok {
			continue
		}
		rows = append(rows, merged(base, params(fields)))
	}
	return rows
}

// expandGit walks the tree for a git generator's directories or files. The
// paths are repository-relative, as the controller reads them, so the
// walk starts at the repository root and not at the input root.
func (e *expander) expandGit(gen map[string]any, base params) []params {
	if e.repo != "" {
		if at := bareRepo(str(gen, "repoURL")); at != "" && at != e.repo {
			e.b.Warn(e.name, fmt.Sprintf("a git generator points at %s, which is not this repository, and is passed over", at))
			return nil
		}
	}
	var rows []params
	var includes, excludes []string
	for _, entry := range list(gen, "directories") {
		fields, _ := entry.(map[string]any)
		path := str(fields, "path")
		if path == "" {
			continue
		}
		if exclude, _ := fields["exclude"].(bool); exclude {
			excludes = append(excludes, path)
		} else {
			includes = append(includes, path)
		}
	}
	for _, pattern := range includes {
		for _, dir := range e.glob(pattern, true) {
			if matchesAny(dir, excludes) {
				continue
			}
			rows = append(rows, merged(base, pathParams(dir, "")))
		}
	}
	for _, entry := range list(gen, "files") {
		fields, _ := entry.(map[string]any)
		pattern := str(fields, "path")
		if pattern == "" {
			continue
		}
		for _, file := range e.glob(pattern, false) {
			raw, err := os.ReadFile(filepath.Join(e.repoRoot, filepath.FromSlash(file)))
			if err != nil {
				e.b.Warn(file, "could not be read for the files generator")
				continue
			}
			var fields map[string]any
			if err := yaml.Unmarshal(raw, &fields); err != nil {
				e.b.Warn(file, "is not YAML or JSON and the files generator passes it over")
				continue
			}
			row := merged(base, params(fields))
			for k, v := range pathParams(filepath.ToSlash(filepath.Dir(file)), filepath.Base(file)) {
				row[k] = v
			}
			rows = append(rows, row)
		}
	}
	return rows
}

// expandMatrix is the rows of the first generator, each crossed with the
// rows of the second rendered with it - which is what lets the second walk
// `envs/{{.env}}/shop/*` for every `env` the first found.
func (e *expander) expandMatrix(gen map[string]any, base params) []params {
	children := list(gen, "generators")
	if len(children) != 2 {
		e.b.Warn(e.name, fmt.Sprintf("a matrix generator holds %d generators; it takes exactly two", len(children)))
		return nil
	}
	first, _ := children[0].(map[string]any)
	second, _ := children[1].(map[string]any)
	var rows []params
	for _, row := range e.expand(first, base) {
		rendered, err := e.renderMap(second, row)
		if err != nil {
			e.b.Warn(e.name, "the second matrix generator could not be rendered with the first's row: "+err.Error())
			continue
		}
		rows = append(rows, e.expand(rendered, row)...)
	}
	return rows
}

// glob resolves a repository-relative pattern against the tree. `*` and
// `?` in a segment, as the controller takes them; `**` is one level here,
// which is a warning rather than a silent miss.
func (e *expander) glob(pattern string, dirs bool) []string {
	if strings.Contains(pattern, "**") {
		e.b.Warn(e.name, fmt.Sprintf("%q uses **, which this reader walks as one level", pattern))
	}
	matches, err := filepath.Glob(filepath.Join(e.repoRoot, filepath.FromSlash(pattern)))
	if err != nil {
		e.b.Warn(e.name, fmt.Sprintf("%q is not a pattern this reader understands", pattern))
		return nil
	}
	var out []string
	for _, match := range matches {
		info, err := os.Stat(match)
		if err != nil || info.IsDir() != dirs {
			continue
		}
		rel, err := filepath.Rel(e.repoRoot, match)
		if err != nil {
			continue
		}
		out = append(out, filepath.ToSlash(rel))
	}
	sort.Strings(out)
	return out
}

func matchesAny(path string, patterns []string) bool {
	for _, pattern := range patterns {
		if ok, _ := filepath.Match(filepath.FromSlash(pattern), filepath.FromSlash(path)); ok {
			return true
		}
	}
	return false
}

// pathParams is what the controller puts under `path` for a directory or
// a file the git generator found.
func pathParams(dir, file string) params {
	base := filepath.Base(filepath.FromSlash(dir))
	segments := []any{}
	for _, segment := range strings.Split(dir, "/") {
		if segment != "" {
			segments = append(segments, segment)
		}
	}
	path := map[string]any{
		"path":               dir,
		"basename":           base,
		"basenameNormalized": normalized(base),
		"segments":           segments,
	}
	if file != "" {
		path["filename"] = file
		path["filenameNormalized"] = normalized(file)
	}
	return params{"path": path}
}

var notAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func normalized(name string) string {
	return strings.Trim(notAlnum.ReplaceAllString(strings.ToLower(name), "-"), "-")
}

func merged(base, over params) params {
	out := params{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range over {
		out[k] = v
	}
	return out
}

// renderMap renders every string in a map through the template with the
// row: the whole thing goes through YAML and back, which is what keeps the
// reader from knowing which fields the controller lets a row into.
func (e *expander) renderMap(m map[string]any, row params) (map[string]any, error) {
	text, err := yaml.Marshal(m)
	if err != nil {
		return nil, err
	}
	rendered, err := e.render(string(text), row)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := yaml.Unmarshal([]byte(rendered), &out); err != nil {
		return nil, fmt.Errorf("rendered text is not YAML: %w", err)
	}
	return out, nil
}

var fastPlaceholder = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

// render is the template language the ApplicationSet declared: Go's
// text/template when goTemplate is set, else fasttemplate's `{{a.b}}`
// looked up in the flattened row.
func (e *expander) render(text string, row params) (string, error) {
	if !e.goTemplate {
		flat := flatten("", row, map[string]string{})
		var missing []string
		out := fastPlaceholder.ReplaceAllStringFunc(text, func(match string) string {
			key := strings.TrimSpace(fastPlaceholder.FindStringSubmatch(match)[1])
			value, ok := flat[key]
			if !ok {
				missing = append(missing, key)
				return match
			}
			return value
		})
		if len(missing) > 0 {
			return "", fmt.Errorf("no value for %s", strings.Join(missing, ", "))
		}
		return out, nil
	}
	tmpl, err := template.New("appset").Option("missingkey=" + e.missingKey).Parse(text)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, map[string]any(row)); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// flatten writes a nested row as dotted keys, the way fasttemplate reads
// it: `cluster.name`, `path.basename`, `path[0]`.
func flatten(prefix string, value any, into map[string]string) map[string]string {
	switch v := value.(type) {
	case params:
		for k, inner := range v {
			flatten(join(prefix, k), inner, into)
		}
	case map[string]any:
		for k, inner := range v {
			flatten(join(prefix, k), inner, into)
		}
	case []any:
		for i, inner := range v {
			flatten(fmt.Sprintf("%s[%d]", prefix, i), inner, into)
		}
	case nil:
	default:
		into[prefix] = fmt.Sprint(v)
	}
	return into
}

func join(prefix, key string) string {
	if prefix == "" {
		return key
	}
	return prefix + "." + key
}

// applications is every Application an ApplicationSet declares, as the
// controller would render them from the rows its generators produce.
func applications(doc document, repoRoot, repo string, b *plugin.Builder) []map[string]any {
	spec := sub(doc.body, "spec")
	meta := sub(doc.body, "metadata")
	name := str(meta, "name")
	if name == "" {
		name = doc.file
	}
	goTemplate, _ := spec["goTemplate"].(bool)
	missingKey := "zero"
	for _, option := range list(spec, "goTemplateOptions") {
		if s, _ := option.(string); strings.HasPrefix(s, "missingkey=") {
			missingKey = strings.TrimPrefix(s, "missingkey=")
		}
	}
	e := &expander{name: name, repoRoot: repoRoot, repo: repo, goTemplate: goTemplate, missingKey: missingKey, b: b}

	var rows []params
	for _, gen := range list(spec, "generators") {
		fields, ok := gen.(map[string]any)
		if !ok {
			continue
		}
		rows = append(rows, e.expand(fields, params{})...)
	}

	tmpl := sub(spec, "template")
	if tmpl == nil {
		b.Warn(name, "declares no template, so its generators make nothing")
		return nil
	}
	var out []map[string]any
	for _, row := range rows {
		app, err := e.renderMap(tmpl, row)
		if err != nil {
			b.Warn(name, "one row could not be rendered into an Application: "+err.Error())
			continue
		}
		// The template's metadata has no namespace of its own; the
		// controller puts the Application beside the ApplicationSet.
		if appMeta := sub(app, "metadata"); appMeta != nil && str(appMeta, "namespace") == "" {
			appMeta["namespace"] = str(meta, "namespace")
		}
		out = append(out, app)
	}
	return out
}
