package extractcommands

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func mustWrite(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func fragment(t *testing.T, resp plugin.Response) catalog.Catalog {
	t.Helper()
	var got catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}

	return got
}

func TestListsCommandsOnTheNamedService(t *testing.T) {
	root := filepath.Join(t.TempDir(), "shop", "cart")
	mustWrite(t, filepath.Join(root, "Makefile"), "test: ## Run the tests\n\tgo test ./...\n")
	mustWrite(t, filepath.Join(root, "package.json"), `{"scripts":{"build":"tsc"}}`)

	resp, err := extract(plugin.Input{Root: root}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Files[0].Name != "commands.json" {
		t.Errorf("file = %q", resp.Files[0].Name)
	}
	got := fragment(t, resp)
	if len(got.Contexts) != 1 || got.Contexts[0].ID != "shop" {
		t.Fatalf("fragment = %+v", got)
	}
	svc := got.Contexts[0].Services[0]
	if svc.ID != "shop.cart" || svc.Slug != "cart" || svc.Name != "" || svc.Readme != "" {
		t.Errorf("the fragment claims only the id: %+v", svc)
	}
	if len(svc.Commands) != 2 || svc.Commands[0].Run != "make test" || svc.Commands[0].Doc != "Run the tests" || svc.Commands[1].Run != "npm run build" {
		t.Errorf("commands = %+v", svc.Commands)
	}
	if len(resp.Warnings()) != 0 {
		t.Errorf("warnings = %+v", resp.Warnings())
	}
}

func TestOptionsNameTheService(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "justfile"), "dev:\n    cargo run\n")

	resp, err := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "oms", Out: "cmds.json"})
	if err != nil {
		t.Fatal(err)
	}
	got := fragment(t, resp)
	if resp.Files[0].Name != "cmds.json" || got.Contexts[0].Services[0].ID != "shop.oms" {
		t.Errorf("file = %q, service = %q", resp.Files[0].Name, got.Contexts[0].Services[0].ID)
	}
}

func TestNothingDeclaredWarns(t *testing.T) {
	resp, err := extract(plugin.Input{Root: t.TempDir()}, Options{Context: "shop", Service: "oms"})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Warnings()) != 1 {
		t.Errorf("warnings = %+v", resp.Warnings())
	}
	if got := fragment(t, resp); len(got.Contexts[0].Services[0].Commands) != 0 {
		t.Errorf("commands = %+v", got.Contexts[0].Services[0].Commands)
	}
}

func TestRefusesANonSlug(t *testing.T) {
	if _, err := extract(plugin.Input{Root: t.TempDir()}, Options{Context: "Shop Front", Service: "oms"}); err == nil {
		t.Error("a context with a space in it is not an id")
	}
}
