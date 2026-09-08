package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every built-in that portolan.json points at portolan-go.wasm, or runs as
// `portolan-go <name>`, must be a name this binary answers to - and nothing
// here may be a name the manifest does not know.
func TestPluginsMatchTheManifest(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "portolan.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Plugins []struct {
			Name    string `json:"name"`
			Wasm    *struct{ URL string `json:"url"` }
			Process *struct {
				Command string   `json:"command"`
				Args    []string `json:"args"`
			}
		} `json:"plugins"`
	}
	if err := json.Unmarshal(source, &manifest); err != nil {
		t.Fatal(err)
	}

	declared := map[string]bool{}
	for _, plugin := range manifest.Plugins {
		viaWasm := plugin.Wasm != nil && strings.HasSuffix(plugin.Wasm.URL, "/portolan-go.wasm")
		viaProcess := plugin.Process != nil && len(plugin.Process.Args) == 3 && plugin.Process.Args[1] == "./plugins/cmd/portolan-go"
		if !viaWasm && !viaProcess {
			continue
		}
		name := plugin.Name
		if viaProcess {
			name = plugin.Process.Args[2]
		}
		declared[name] = true
		if _, ok := Plugins[name]; !ok {
			t.Errorf("portolan.json runs %q through portolan-go, which has no such plugin", name)
		}
	}
	for name := range Plugins {
		if !declared[name] {
			t.Errorf("portolan-go answers to %q, which portolan.json never routes here", name)
		}
	}
}

func TestPluginName(t *testing.T) {
	cases := map[string][]string{
		"adr":     {"portolan-go", "adr"},
		"project": {"project"},
		"openapi": {"/tmp/openapi.wasm"},
		"":        {},
	}
	for want, args := range cases {
		if got := pluginName(args); got != want {
			t.Errorf("pluginName(%q) = %q, want %q", args, got, want)
		}
	}
}
