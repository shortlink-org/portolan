// Package extractdeploymentvalues reads environment-shaped YAML values into
// source-backed configuration bindings. Bindings refine facts extracted from
// code; they never assert a call, channel or store on their own.
package extractdeploymentvalues

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"gopkg.in/yaml.v3"
)

type Options struct {
	Context   string   `json:"context"`
	Service   string   `json:"service"`
	Paths     []string `json:"paths"`
	Variables []string `json:"variables"`
	Out       string   `json:"out,omitempty"`
}

var (
	environmentFile = regexp.MustCompile(`(?i)(?:^|[._-])(prod(?:uction)?|dev(?:elopment)?|stag(?:e|ing)?|test|qa)(?:[._-]|$)`)
	environmentKey  = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)
	sensitiveKey    = regexp.MustCompile(`(?i)(?:^|_)(?:PASSWORD|PASS|TOKEN|SECRET|PRIVATE_KEY|ACCESS_KEY|API_KEY|AUTH|CREDENTIALS?|DSN|CONN(?:ECTION)?_STR(?:ING)?)(?:_|$)`)
)

func Serve(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: an extractor has nothing to read")
		}
		return extract(req.Input, opts)
	})
}

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	if opts.Context == "" || opts.Service == "" {
		return plugin.Response{}, fmt.Errorf("context and service are required")
	}
	if len(opts.Paths) == 0 {
		return plugin.Response{}, fmt.Errorf("paths must name at least one deployment values document")
	}
	if len(opts.Variables) == 0 {
		return plugin.Response{}, fmt.Errorf("variables must name at least one environment variable observed in source code")
	}
	allowed := make(map[string]bool, len(opts.Variables))
	for _, variable := range opts.Variables {
		if environmentKey.MatchString(variable) {
			allowed[variable] = true
		}
	}
	bindings := make([]catalog.ConfigurationBinding, 0)
	for _, name := range opts.Paths {
		clean := filepath.Clean(filepath.ToSlash(name))
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") {
			return plugin.Response{}, fmt.Errorf("path %q must stay inside the input root", name)
		}
		fileBindings, err := readBindings(in, clean, opts.Context+"."+opts.Service, allowed)
		if err != nil {
			return plugin.Response{}, err
		}
		bindings = append(bindings, fileBindings...)
	}
	sort.Slice(bindings, func(i, j int) bool {
		if bindings[i].Environment != bindings[j].Environment {
			return bindings[i].Environment < bindings[j].Environment
		}
		if bindings[i].Variable != bindings[j].Variable {
			return bindings[i].Variable < bindings[j].Variable
		}
		return bindings[i].Source < bindings[j].Source
	})

	fragment := catalog.Catalog{
		Contexts:              []catalog.BoundedContext{},
		Defs:                  map[string]catalog.TypeDef{},
		Flows:                 []catalog.Flow{},
		Adrs:                  []catalog.Adr{},
		ConfigurationBindings: bindings,
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b := &plugin.Builder{}
	out := opts.Out
	if out == "" {
		out = "deployment-values.json"
	}
	b.File(out, string(encoded)+"\n")
	return b.Response(), nil
}

func readBindings(in plugin.Input, name, service string, allowed map[string]bool) ([]catalog.ConfigurationBinding, error) {
	file, err := os.Open(filepath.Join(in.Root, filepath.FromSlash(name)))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", name, err)
	}
	defer file.Close()

	environment := environmentOf(name)
	decoder := yaml.NewDecoder(file)
	var out []catalog.ConfigurationBinding
	for {
		var document yaml.Node
		err := decoder.Decode(&document)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", name, err)
		}
		collectBindings(document.Content, in, name, service, environment, allowed, &out)
	}
	return out, nil
}

func collectBindings(nodes []*yaml.Node, in plugin.Input, name, service, environment string, allowed map[string]bool, out *[]catalog.ConfigurationBinding) {
	for _, node := range nodes {
		switch node.Kind {
		case yaml.MappingNode:
			for i := 0; i+1 < len(node.Content); i += 2 {
				key, value := node.Content[i], node.Content[i+1]
				if allowed[key.Value] && value.Kind == yaml.ScalarNode {
					binding := catalog.ConfigurationBinding{
						Service: service, Environment: environment, Variable: key.Value,
						Source: in.RootSource(fmt.Sprintf("%s:%d", name, key.Line)),
					}
					if secretReference(key.Value, value.Value) {
						binding.SecretRef = value.Value
						if !strings.HasPrefix(value.Value, "vault:") {
							binding.SecretRef = "redacted"
						}
					} else {
						binding.Value = value.Value
					}
					*out = append(*out, binding)
				}
				collectBindings([]*yaml.Node{value}, in, name, service, environment, allowed, out)
			}
		case yaml.SequenceNode, yaml.DocumentNode:
			collectBindings(node.Content, in, name, service, environment, allowed, out)
		}
	}
}

func environmentOf(name string) string {
	match := environmentFile.FindStringSubmatch(filepath.Base(name))
	if len(match) < 2 {
		return "unplaced"
	}
	switch strings.ToLower(match[1]) {
	case "production", "prod":
		return "prod"
	case "development", "dev":
		return "dev"
	case "stage", "staging":
		return "staging"
	default:
		return strings.ToLower(match[1])
	}
}

func secretReference(variable, value string) bool {
	if strings.HasPrefix(value, "vault:") || sensitiveKey.MatchString(variable) {
		return true
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.User != nil
}

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:     "extract-deployment-values",
		Summary:  "Reads environment-scoped deployment values into safe configuration bindings.",
		Category: plugin.CategoryInfrastructure,
		Phases:   []string{plugin.PhaseExtract},
		Options:  optionsSchema,
	}
}

//go:embed options.schema.json
var optionsSchema []byte
