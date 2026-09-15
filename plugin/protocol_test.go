package plugin_test

import (
	"testing"

	"github.com/shortlink-org/portolan/plugin"
)

// A vendored copy is read against its own repository, and a monorepo service
// against the workspace, which is its repository; both come out as the forge
// spells them.
func TestRepositoryPathIsSpelledFromTheRepository(t *testing.T) {
	vendored := plugin.Input{Root: "vendor/repos/acme/shop", Repository: "vendor/repos/acme/shop"}
	monorepo := plugin.Input{Root: "examples/shop/oms"}

	for _, tc := range []struct {
		in   plugin.Input
		path string
		want string
	}{
		{vendored, "vendor/repos/acme/shop", ""},
		{vendored, "vendor/repos/acme/shop/", ""},
		{vendored, "vendor/repos/acme/shop/services/oms/order.go", "services/oms/order.go"},
		{vendored, "vendor/repos/acme/shopfront/main.go", "vendor/repos/acme/shopfront/main.go"},
		{vendored, "portolan/flows.json", "portolan/flows.json"},
		{monorepo, "examples/shop/oms", "examples/shop/oms"},
		{monorepo, "examples/shop/oms/src/main.rs", "examples/shop/oms/src/main.rs"},
		{plugin.Input{Repository: "."}, "a/b.go", "a/b.go"},
	} {
		if got := tc.in.RepositoryPath(tc.path); got != tc.want {
			t.Errorf("Repository %q: RepositoryPath(%q) = %q, want %q", tc.in.Repository, tc.path, got, tc.want)
		}
	}

	for where, want := range map[string]string{
		"vendor/repos/acme/shop/Makefile:14":  "Makefile:14",
		"vendor/repos/acme/shop/package.json": "package.json",
		"vendor/repos/acme/shop/a:b.go":       "a:b.go",
	} {
		if got := vendored.RepositorySource(where); got != want {
			t.Errorf("RepositorySource(%q) = %q, want %q", where, got, want)
		}
	}
}
