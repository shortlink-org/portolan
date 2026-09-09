package extractproject

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/commands"
	"github.com/shortlink-org/portolan/plugin"
)

var packageRepository = regexp.MustCompile(`(?m)"repository"\s*:\s*(?:"([^"]+)"|\{[^}]*"url"\s*:\s*"([^"]+)")`)
var cargoName = regexp.MustCompile(`(?m)^name\s*=\s*"([^"]+)"`)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	root := in.Root
	base := slug(filepath.Base(root))
	group := firstNonEmpty(slug(opts.Group), base, "project")
	component := firstNonEmpty(slug(opts.Component), base, "component")
	readme := read(filepath.Join(root, "README.md"))
	b := &plugin.Builder{}
	cmds, warnings := commands.Read(root)
	for _, warning := range warnings {
		b.Warn(root, warning)
	}

	services := []catalog.Service{}
	if len(opts.Components) == 0 {
		services = append(services, projectService(root, group, component, firstNonEmpty(opts.ComponentName, markdownTitle(readme), title(component)), firstNonEmpty(opts.ComponentKind, inferredKind(root)), firstNonEmpty(opts.Repo, repository(root)), readme, opts.Technologies, cmds))
	} else {
		seen := map[string]bool{}
		componentTechnologies := opts.Technologies
		if len(componentTechnologies) == 0 {
			componentTechnologies = sharedTechnologies(root)
		}
		for _, candidate := range opts.Components {
			componentSlug := slug(candidate.Slug)
			if componentSlug == "" || seen[componentSlug] {
				continue
			}
			seen[componentSlug] = true
			services = append(services, projectService(root, group, componentSlug, firstNonEmpty(candidate.Name, title(componentSlug)), firstNonEmpty(candidate.Kind, string(catalog.ComponentKindService)), firstNonEmpty(opts.Repo, repository(root)), readme, componentTechnologies, cmds))
		}
	}

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts: []catalog.BoundedContext{{
			ID:             group,
			Slug:           group,
			Name:           firstNonEmpty(opts.GroupName, title(group)),
			Summary:        opts.GroupSummary,
			Kind:           catalog.GroupKind(firstNonEmpty(opts.GroupKind, string(catalog.GroupKindSystem))),
			Classification: catalog.Classification(opts.Classification),
			Services:       services,
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{},
		Adrs:  []catalog.Adr{},
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(firstNonEmpty(opts.Out, "project.json"), string(encoded)+"\n")
	return b.Response(), nil
}

func sharedTechnologies(root string) []string {
	shareable := map[string]bool{"Go": true, "Node.js": true, "Rust": true, "Java": true, "Python": true, "Docker": true, "Helm": true}
	var out []string
	for _, technology := range technologies(root) {
		if shareable[technology] {
			out = append(out, technology)
		}
	}
	return out
}

func projectService(root, group, component, name, kind, repo, readme string, statedTechnologies []string, cmds []catalog.Command) catalog.Service {
	return catalog.Service{
		ID:           group + "." + component,
		Slug:         component,
		Name:         name,
		Repo:         repo,
		Path:         filepath.ToSlash(root),
		Readme:       readme,
		Kind:         catalog.ComponentKind(kind),
		Technologies: stated(statedTechnologies, technologies(root)),
		Provides:     []catalog.RpcService{},
		Consumes:     []catalog.RpcCall{},
		Aggregates:   []catalog.Aggregate{},
		Commands:     cmds,
	}
}

func repository(root string) string {
	for _, line := range strings.Split(read(filepath.Join(root, "go.mod")), "\n") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
			return strings.TrimSpace(value)
		}
	}
	if match := packageRepository.FindStringSubmatch(read(filepath.Join(root, "package.json"))); len(match) > 0 {
		return strings.TrimSuffix(firstNonEmpty(match[1], match[2]), ".git")
	}
	if match := cargoName.FindStringSubmatch(read(filepath.Join(root, "Cargo.toml"))); len(match) > 0 {
		return match[1]
	}
	return ""
}

func inferredKind(root string) string {
	if exists(filepath.Join(root, "cmd")) || exists(filepath.Join(root, "Dockerfile")) || exists(filepath.Join(root, "docker-compose.yml")) || exists(filepath.Join(root, "docker-compose.yaml")) {
		return string(catalog.ComponentKindApplication)
	}
	return string(catalog.ComponentKindLibrary)
}

func technologies(root string) []string {
	goMod := read(filepath.Join(root, "go.mod"))
	packageJSON := read(filepath.Join(root, "package.json"))
	cargo := read(filepath.Join(root, "Cargo.toml"))
	markers := []struct {
		name string
		seen bool
	}{
		{"Go", goMod != ""},
		{"Node.js", packageJSON != ""},
		{"Rust", cargo != ""},
		{"Java", exists(filepath.Join(root, "pom.xml")) || exists(filepath.Join(root, "build.gradle")) || exists(filepath.Join(root, "build.gradle.kts"))},
		{"Python", exists(filepath.Join(root, "pyproject.toml")) || exists(filepath.Join(root, "requirements.txt")) || exists(filepath.Join(root, "manage.py"))},
		{"Gin", strings.Contains(goMod, "github.com/gin-gonic/gin")},
		{"Kafka", strings.Contains(goMod, "segmentio/kafka-go") || strings.Contains(goMod, "Shopify/sarama") || strings.Contains(goMod, "IBM/sarama") || strings.Contains(goMod, "ThreeDotsLabs/watermill-kafka")},
		{"PostgreSQL", strings.Contains(goMod, "jackc/pgx") || strings.Contains(goMod, "lib/pq")},
		{"Redis", strings.Contains(goMod, "go-redis/redis") || strings.Contains(goMod, "redis/go-redis")},
		{"OpenTelemetry", strings.Contains(goMod, "go.opentelemetry.io/otel")},
		{"River", strings.Contains(goMod, "riverqueue/river")},
		{"Watermill", strings.Contains(goMod, "github.com/ThreeDotsLabs/watermill")},
		{"Docker", exists(filepath.Join(root, "Dockerfile")) || exists(filepath.Join(root, "docker-compose.yml")) || exists(filepath.Join(root, "docker-compose.yaml"))},
		{"Helm", hasHelm(root)},
	}
	out := make([]string, 0, len(markers))
	for _, marker := range markers {
		if marker.seen {
			out = append(out, marker.name)
		}
	}
	return out
}

func hasHelm(root string) bool {
	if exists(filepath.Join(root, "Chart.yaml")) || exists(filepath.Join(root, "charts")) || exists(filepath.Join(root, "helm")) {
		return true
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(strings.ToLower(entry.Name()), ".helm") {
			return true
		}
	}
	return false
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func read(path string) string {
	contents, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(contents))
}

func markdownTitle(md string) string {
	fence := ""
	for _, line := range strings.Split(md, "\n") {
		trimmed := strings.TrimSpace(line)
		marker := ""
		if strings.HasPrefix(trimmed, "```") {
			marker = "```"
		} else if strings.HasPrefix(trimmed, "~~~") {
			marker = "~~~"
		}
		if marker != "" {
			if fence == "" {
				fence = marker
			} else if fence == marker {
				fence = ""
			}
			continue
		}
		if fence != "" {
			continue
		}
		if value, ok := strings.CutPrefix(trimmed, "# "); ok {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func slug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var out strings.Builder
	dash := false
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			out.WriteRune(r)
			dash = false
		} else if out.Len() > 0 && !dash {
			out.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(out.String(), "-")
}

func title(value string) string {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '-' || r == '_' })
	for i := range parts {
		if parts[i] != "" {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, " ")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// stated prefers what the manifest says to what the tree implies: a component
// whose manifests sit above its root, one of several in a repository, has
// nothing at its root for technologies to read.
func stated(told, inferred []string) []string {
	if len(told) > 0 {
		return told
	}
	return inferred
}
