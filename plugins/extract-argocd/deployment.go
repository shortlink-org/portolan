package extractargocd

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/shortlink-org/portolan/catalog"
)

// inClusterServer is how Argo CD names the cluster it runs in, and
// inClusterName how the catalog does - the same words fetch-argocd uses.
const (
	inClusterServer = "https://kubernetes.default.svc"
	inClusterName   = "in-cluster"
)

// deploymentOf reduces one Application to what the tree declares about it.
// The same reduction fetch-argocd makes of the API's answer, minus what a
// tree cannot know: the revision synced, the images running, the link.
// The tool and the declared images come from the overlay when the path
// holds a kustomization - a tree can know that where a control plane says
// it after the first sync.
func deploymentOf(app map[string]any, repoRoot string, opts Options) (catalog.Deployment, bool) {
	meta := sub(app, "metadata")
	spec := sub(app, "spec")
	name := str(meta, "name")
	if name == "" {
		return catalog.Deployment{}, false
	}
	namespace := str(meta, "namespace")
	if namespace == "" {
		namespace = "argocd"
	}

	// A multi-source Application deploys the source that carries a path
	// and reads values out of the others.
	var sources []map[string]any
	for _, entry := range list(spec, "sources") {
		if fields, ok := entry.(map[string]any); ok {
			sources = append(sources, fields)
		}
	}
	if len(sources) == 0 {
		if single := sub(spec, "source"); single != nil {
			sources = []map[string]any{single}
		}
	}
	var source map[string]any
	for _, candidate := range sources {
		if str(candidate, "path") != "" {
			source = candidate
			break
		}
	}
	if source == nil && len(sources) > 0 {
		source = sources[0]
	}

	destination := sub(spec, "destination")
	server := str(destination, "server")
	cluster := str(destination, "name")
	if cluster == "" {
		if server == inClusterServer {
			cluster = inClusterName
		} else {
			cluster = server
		}
	}
	labels := stringMap(meta, "labels")
	environment := strings.TrimSpace(labels[opts.EnvironmentLabel])
	if environment == "" {
		environment = cluster
	}

	path := strings.Trim(strings.TrimPrefix(str(source, "path"), "./"), "/")
	d := catalog.Deployment{
		ID:             namespace + "/" + name,
		Name:           name,
		Project:        firstNonEmpty(str(spec, "project"), "default"),
		Environment:    environment,
		Cluster:        cluster,
		Namespace:      str(destination, "namespace"),
		Repo:           bareRepo(str(source, "repoURL")),
		Path:           path,
		Chart:          str(source, "chart"),
		TargetRevision: str(source, "targetRevision"),
		Tool:           toolOf(sources),
		Basis:          "manifest",
	}
	if context, service := strings.TrimSpace(labels[opts.Labels.Context]), strings.TrimSpace(labels[opts.Labels.Service]); context != "" && service != "" {
		d.Service = context + "." + service
	}
	if path != "" && repoRoot != "" {
		if declared, ok := kustomization(filepath.Join(repoRoot, filepath.FromSlash(path))); ok {
			if d.Tool == "" {
				d.Tool = "kustomize"
			}
			d.Images = declared
		}
	}
	return d, true
}

// toolOf is what the sources say they are rendered with, in the words
// Argo CD uses for its sourceType, lowercased; empty when nothing says.
func toolOf(sources []map[string]any) string {
	for _, source := range sources {
		switch {
		case str(source, "chart") != "", source["helm"] != nil:
			return "helm"
		case source["kustomize"] != nil:
			return "kustomize"
		case source["plugin"] != nil:
			return "plugin"
		case source["directory"] != nil:
			return "directory"
		}
	}
	return ""
}

// kustomization reads the images an overlay pins, when the directory holds
// one: `name` as `newName:newTag` or `newName@digest`. An entry that pins
// nothing beyond the name says nothing the base did not, and is left out.
func kustomization(dir string) ([]string, bool) {
	var raw []byte
	var err error
	for _, name := range []string{"kustomization.yaml", "kustomization.yml", "Kustomization"} {
		raw, err = os.ReadFile(filepath.Join(dir, name))
		if err == nil {
			break
		}
	}
	if err != nil {
		return nil, false
	}
	var body map[string]any
	if err := yaml.Unmarshal(raw, &body); err != nil {
		return nil, true
	}
	var images []string
	for _, entry := range list(body, "images") {
		fields, _ := entry.(map[string]any)
		name := firstNonEmpty(str(fields, "newName"), str(fields, "name"))
		if name == "" {
			continue
		}
		switch {
		case str(fields, "digest") != "":
			images = append(images, name+"@"+str(fields, "digest"))
		case str(fields, "newTag") != "":
			images = append(images, name+":"+str(fields, "newTag"))
		}
	}
	sort.Strings(images)
	return images, true
}

var schemeAndUser = regexp.MustCompile(`^[a-z+]+://(?:[^@/]+@)?`)

// bareRepo spells a repository the way Service.repo does - host/owner/name
// - whatever form the manifest used: an https URL, an ssh URL, git@host:path.
func bareRepo(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "git@") {
		rest := strings.TrimPrefix(value, "git@")
		if colon := strings.Index(rest, ":"); colon >= 0 {
			value = rest[:colon] + "/" + rest[colon+1:]
		} else {
			value = rest
		}
	} else {
		value = schemeAndUser.ReplaceAllString(value, "")
	}
	value = strings.Trim(value, "/")
	return strings.TrimSuffix(value, ".git")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
