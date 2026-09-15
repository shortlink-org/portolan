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

// A function key is spelled from the repository the way a source is.
func TestFunctionKeysAreSpelledFromTheRepository(t *testing.T) {
	vendored := plugin.Input{Root: "vendor/repos/acme/shop/services/oms", Repository: "vendor/repos/acme/shop"}
	whole := plugin.Input{Root: "vendor/repos/acme/shop", Repository: "vendor/repos/acme/shop"}
	monorepo := plugin.Input{Root: "examples/shop/oms"}
	temporary := plugin.Input{Root: "/tmp/fixture"}

	for _, tc := range []struct {
		in   plugin.Input
		key  string
		want string
	}{
		{monorepo, "internal/app:Service.Run", "examples/shop/oms/internal/app:Service.Run"},
		{monorepo, "main", "examples/shop/oms:main"},
		{monorepo, "", ""},
		{vendored, "internal/jobs:Worker.Work", "services/oms/internal/jobs:Worker.Work"},
		{whole, "internal/jobs:Worker.Work", "internal/jobs:Worker.Work"},
		{whole, "main", "main"},
		{temporary, "internal/app:Service.Run", "internal/app:Service.Run"},
		{temporary, "main", "main"},
		{plugin.Input{Root: "."}, "internal/app:Run", "internal/app:Run"},
	} {
		if got := tc.in.RootFunction(tc.key); got != tc.want {
			t.Errorf("Root %q: RootFunction(%q) = %q, want %q", tc.in.Root, tc.key, got, tc.want)
		}
	}

	for key, want := range map[string]string{
		"vendor/repos/acme/shop/internal/app:Service.Run": "internal/app:Service.Run",
		"vendor/repos/acme/shop:main":                     "main",
		"examples/shop/oms/internal/app:Service.Run":      "examples/shop/oms/internal/app:Service.Run",
		"Service.Run": "Service.Run",
	} {
		if got := whole.RepositoryFunction(key); got != want {
			t.Errorf("RepositoryFunction(%q) = %q, want %q", key, got, want)
		}
	}
}

// A path spelled from Root is spelled from the repository the same way.
func TestRootPathIsSpelledFromTheRepository(t *testing.T) {
	vendored := plugin.Input{Root: "vendor/repos/acme/shop/services/oms", Repository: "vendor/repos/acme/shop"}
	monorepo := plugin.Input{Root: "examples/shop/pricing"}
	whole := plugin.Input{Root: "vendor/repos/acme/shop", Repository: "vendor/repos/acme/shop"}
	temporary := plugin.Input{Root: "/tmp/fixture"}

	for _, tc := range []struct {
		in   plugin.Input
		rel  string
		want string
	}{
		{vendored, "internal/app.go:12", "services/oms/internal/app.go:12"},
		{vendored, ".", "services/oms"},
		{whole, ".", ""},
		{whole, "internal/app.go", "internal/app.go"},
		{monorepo, "internal/di/app.go:67", "examples/shop/pricing/internal/di/app.go:67"},
		{monorepo, "", ""},
		{monorepo, ".", "examples/shop/pricing"},
		{temporary, "internal/app.go:3", "internal/app.go:3"},
		{plugin.Input{Root: "."}, "internal/app.go", "internal/app.go"},
	} {
		if got := tc.in.RootSource(tc.rel); got != tc.want {
			t.Errorf("Root %q: RootSource(%q) = %q, want %q", tc.in.Root, tc.rel, got, tc.want)
		}
	}
}
