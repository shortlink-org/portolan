package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestExtractsANeutralApplicationWithoutDDD(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "README.md"), "# Flight support\n\nCoordinates providers.\n")
	mustWrite(t, filepath.Join(root, "go.mod"), "module example.com/flight/support\n")
	mustWrite(t, filepath.Join(root, "cmd", "support", "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, "Dockerfile"), "FROM scratch\n")
	mustWrite(t, filepath.Join(root, "Makefile"), "build: ## Compile the binary\n\tgo build ./cmd/support\n")

	response, err := extract(plugin.Input{Root: root, Commit: "abc", GeneratedAt: "2026-09-06T00:00:00Z"}, Options{Group: "avia", Component: "support"})
	if err != nil {
		t.Fatal(err)
	}
	var got catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}
	group := got.Contexts[0]
	component := group.Services[0]
	if group.Kind != catalog.GroupKindSystem {
		t.Errorf("group kind = %q", group.Kind)
	}
	if component.Kind != catalog.ComponentKindApplication {
		t.Errorf("component kind = %q", component.Kind)
	}
	if component.Name != "Flight support" || component.Repo != "example.com/flight/support" {
		t.Errorf("component = %+v", component)
	}
	if len(component.Technologies) != 2 || component.Technologies[0] != "Go" || component.Technologies[1] != "Docker" {
		t.Errorf("technologies = %v", component.Technologies)
	}
	if len(component.Aggregates) != 0 {
		t.Fatalf("invented aggregates: %+v", component.Aggregates)
	}
	if len(component.Commands) != 1 || component.Commands[0].Run != "make build" || component.Commands[0].Doc != "Compile the binary" {
		t.Errorf("commands = %+v", component.Commands)
	}
}

func TestExplicitKindsWin(t *testing.T) {
	root := t.TempDir()
	response, err := extract(plugin.Input{Root: root}, Options{Group: "platform", GroupKind: "team", Component: "tools", ComponentKind: "cli"})
	if err != nil {
		t.Fatal(err)
	}
	var got catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}
	if got.Contexts[0].Kind != catalog.GroupKindTeam || got.Contexts[0].Services[0].Kind != catalog.ComponentKindCLI {
		t.Fatalf("explicit kinds were lost: %+v", got.Contexts[0])
	}
}

func TestMarkdownTitleIgnoresShellCommentsInsideFences(t *testing.T) {
	md := "## Getting started\n\n```sh\nmake migrate\n# add superuser\n```\n\n# Actual service\n"
	if got := markdownTitle(md); got != "Actual service" {
		t.Fatalf("markdownTitle = %q", got)
	}
	md = "~~~sh\n# also not a title\n~~~\n"
	if got := markdownTitle(md); got != "" {
		t.Fatalf("markdownTitle without a real H1 = %q", got)
	}
}

func TestRecognizesMessagingLibrariesAsTechnologies(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "go.mod"), `module example.com/worker
require (
	github.com/riverqueue/river v0.26.0
	github.com/ThreeDotsLabs/watermill v1.5.1
	github.com/ThreeDotsLabs/watermill-kafka/v2 v2.5.0
)
`)

	got := technologies(root)
	for _, want := range []string{"Kafka", "River", "Watermill"} {
		found := false
		for _, value := range got {
			if value == want {
				found = true
			}
		}
		if !found {
			t.Errorf("technologies %v do not contain %q", got, want)
		}
	}
}

func mustWrite(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}
