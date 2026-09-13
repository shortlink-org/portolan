package extractdebezium

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/plugin"
	"gopkg.in/yaml.v3"
)

type connector struct {
	name   string
	class  string
	config map[string]string
	source string
}

func discover(root string, paths []string, b *plugin.Builder) ([]connector, error) {
	files, err := candidateFiles(root, paths)
	if err != nil {
		return nil, err
	}

	var out []connector
	for _, path := range files {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		// Walking a GitOps repository means seeing many JSON and YAML files. A
		// cheap marker keeps unrelated documents out of the parser and its notes.
		if !bytes.Contains(bytes.ToLower(raw), []byte("debezium")) {
			continue
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil, err
		}
		source := filepath.ToSlash(rel)

		var found []connector
		switch strings.ToLower(filepath.Ext(path)) {
		case ".json":
			found, err = readJSON(raw, source)
		case ".yaml", ".yml":
			found, err = readYAML(raw, source)
		}
		if err != nil {
			b.Warn(source, err.Error())
			continue
		}
		out = append(out, found...)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].name == out[j].name {
			return out[i].source < out[j].source
		}
		return out[i].name < out[j].name
	})
	for i := 1; i < len(out); i++ {
		if out[i-1].name == out[i].name {
			return nil, fmt.Errorf("Debezium connector %q is declared by both %s and %s", out[i].name, out[i-1].source, out[i].source)
		}
	}

	return out, nil
}

func candidateFiles(root string, paths []string) ([]string, error) {
	if len(paths) == 0 {
		paths = []string{"."}
	}
	seen := map[string]bool{}
	var files []string
	for _, given := range paths {
		clean := filepath.Clean(given)
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("Debezium path %q points outside the input root", given)
		}
		at := filepath.Join(root, clean)
		info, err := os.Stat(at)
		if err != nil {
			return nil, fmt.Errorf("Debezium path %q: %w", given, err)
		}
		if !info.IsDir() {
			if supportedFile(at) && !seen[at] {
				seen[at] = true
				files = append(files, at)
			}
			continue
		}
		if err := filepath.WalkDir(at, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() && path != at && skippedDir(entry.Name()) {
				return filepath.SkipDir
			}
			if entry.IsDir() || !supportedFile(path) || seen[path] {
				return nil
			}
			seen[path] = true
			files = append(files, path)
			return nil
		}); err != nil {
			return nil, err
		}
	}
	sort.Strings(files)
	return files, nil
}

func supportedFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".json", ".yaml", ".yml":
		return true
	}
	return false
}

func skippedDir(name string) bool {
	return strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "target" || name == "dist" || name == "build"
}

func readJSON(raw []byte, source string) ([]connector, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var doc map[string]any
	if err := decoder.Decode(&doc); err != nil {
		return nil, fmt.Errorf("could not be parsed as JSON: %w", err)
	}
	if found, ok := connectorFrom(doc, source+":1"); ok {
		return []connector{found}, nil
	}
	return nil, nil
}

func readYAML(raw []byte, source string) ([]connector, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(raw))
	var out []connector
	for {
		var node yaml.Node
		if err := decoder.Decode(&node); err != nil {
			if err == io.EOF {
				break
			}
			return nil, fmt.Errorf("could not be parsed as YAML: %w", err)
		}
		if len(node.Content) == 0 {
			continue
		}
		var doc map[string]any
		if err := node.Decode(&doc); err != nil {
			return nil, fmt.Errorf("could not be decoded as YAML: %w", err)
		}
		line := node.Content[0].Line
		if found, ok := connectorFrom(doc, fmt.Sprintf("%s:%d", source, line)); ok {
			out = append(out, found)
		}
	}
	return out, nil
}

func connectorFrom(doc map[string]any, source string) (connector, bool) {
	name := scalar(doc["name"])
	config := object(doc["config"])

	if strings.EqualFold(scalar(doc["kind"]), "KafkaConnector") {
		metadata := object(doc["metadata"])
		spec := object(doc["spec"])
		name = scalar(metadata["name"])
		config = object(spec["config"])
		if config == nil {
			config = map[string]any{}
		}
		if class := scalar(spec["class"]); class != "" {
			config["connector.class"] = class
		}
	}
	if config == nil {
		config = doc
	}
	values := stringMap(config)
	class := values["connector.class"]
	if !strings.Contains(class, "io.debezium.connector.") {
		return connector{}, false
	}
	if name == "" {
		path := strings.Split(source, ":")[0]
		base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		name = base
	}

	return connector{name: name, class: class, config: values, source: source}, true
}

func object(value any) map[string]any {
	if value == nil {
		return nil
	}
	if out, ok := value.(map[string]any); ok {
		return out
	}
	return nil
}

func stringMap(values map[string]any) map[string]string {
	out := map[string]string{}
	for key, value := range values {
		if text := scalar(value); text != "" {
			out[key] = text
		}
	}
	return out
}

func scalar(value any) string {
	switch value := value.(type) {
	case string:
		return strings.TrimSpace(value)
	case json.Number:
		return value.String()
	case int, int64, float64, bool:
		return fmt.Sprint(value)
	}
	return ""
}
