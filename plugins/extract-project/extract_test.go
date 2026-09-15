package extractproject

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

	response, err := extract(plugin.Input{Root: root}, Options{Group: "avia", Component: "support"})
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
	response, err := extract(plugin.Input{Root: root}, Options{Group: "platform", GroupKind: "team", Classification: "supporting", Component: "tools", ComponentKind: "cli"})
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
	if got.Contexts[0].Classification != catalog.ClassificationSupporting {
		t.Fatalf("classification = %q", got.Contexts[0].Classification)
	}
}

func TestExtractsSeveralDeployablesFromOneRepository(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "README.md"), "# Commerce platform\n")
	mustWrite(t, filepath.Join(root, "go.mod"), "module example.com/commerce\nrequire github.com/go-redis/redis v6.15.9+incompatible\n")
	mustWrite(t, filepath.Join(root, "Dockerfile"), "FROM scratch\n")

	response, err := extract(plugin.Input{Root: root}, Options{
		Group: "commerce",
		Components: []ComponentOptions{
			{Slug: "api", Name: "API", Kind: "application"},
			{Slug: "billing", Name: "Billing", Kind: "service"},
			{Slug: "billing", Name: "Duplicate"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var got catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}
	services := got.Contexts[0].Services
	if len(services) != 2 {
		t.Fatalf("services = %+v", services)
	}
	if services[0].ID != "commerce.api" || services[0].Name != "API" || services[0].Kind != catalog.ComponentKindApplication {
		t.Errorf("api = %+v", services[0])
	}
	if services[1].ID != "commerce.billing" || services[1].Kind != catalog.ComponentKindService {
		t.Errorf("billing = %+v", services[1])
	}
	if len(services[0].Technologies) != 2 || services[0].Technologies[0] != "Go" || services[0].Technologies[1] != "Docker" {
		t.Errorf("shared technologies = %v", services[0].Technologies)
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

// A snapshot fetched into the workspace is its own repository: the service is
// the whole of it and its runner files are where the forge has them, not
// under the directory the copy was written to. A monorepo service keeps the
// workspace's spelling, which is its repository's.
func TestPathsAreSpelledFromTheRepository(t *testing.T) {
	t.Chdir(t.TempDir())
	mustWrite(t, filepath.Join("vendor", "repos", "acme", "shop", "Makefile"), "build: ## Compile\n\tgo build ./...\n")
	mustWrite(t, filepath.Join("examples", "shop", "oms", "Makefile"), "build: ## Compile\n\tcargo build\n")

	for _, tc := range []struct {
		in       plugin.Input
		wantPath string
		wantCmd  string
	}{
		{plugin.Input{Root: "vendor/repos/acme/shop", Repository: "vendor/repos/acme/shop"}, "", "Makefile:1"},
		{plugin.Input{Root: "examples/shop/oms"}, "examples/shop/oms", "examples/shop/oms/Makefile:1"},
	} {
		response, err := extract(tc.in, Options{Group: "shop", Component: "shop"})
		if err != nil {
			t.Fatal(err)
		}
		var got catalog.Catalog
		if err := json.Unmarshal([]byte(response.Files[0].Contents), &got); err != nil {
			t.Fatal(err)
		}
		service := got.Contexts[0].Services[0]
		if service.Path != tc.wantPath {
			t.Errorf("%s: path = %q, want %q", tc.in.Root, service.Path, tc.wantPath)
		}
		if len(service.Commands) != 1 || service.Commands[0].Source != tc.wantCmd {
			t.Errorf("%s: commands = %+v, want source %q", tc.in.Root, service.Commands, tc.wantCmd)
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
