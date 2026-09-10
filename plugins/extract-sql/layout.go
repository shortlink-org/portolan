package extractsql

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/internal/goscan"
)

type storagePackage struct {
	name       string
	dir        string
	migrations string
}

type storageLayout struct {
	index        *goscan.Tree
	repositories []storagePackage
	projectors   []storagePackage
	source       string
}

// discoverStorageLayout keeps filesystem conventions in one place. Explicit
// roots retain the original "one child package per aggregate" contract, while
// omitted roots discover both horizontal and feature-sliced Go layouts.
func discoverStorageLayout(root, repositories, projectors string) storageLayout {
	var layout storageLayout
	layout.index, _ = goscan.ReadWithOptions(root, goscan.ReadOptions{IncludeGenerated: true, AllowPartial: true})

	if repositories != "" {
		layout.repositories = packagesUnder(root, repositories, "repository")
	} else {
		layout.repositories = discoverPackages(root, "repository")
	}
	if projectors != "" {
		layout.projectors = packagesUnder(root, projectors, "projector")
	} else {
		layout.projectors = discoverPackages(root, "projector")
	}

	if repositories != "" {
		layout.source = filepath.ToSlash(filepath.Join(root, filepath.FromSlash(repositories)))
		return layout
	}
	if projectors != "" {
		layout.source = filepath.ToSlash(filepath.Join(root, filepath.FromSlash(projectors)))
		return layout
	}

	dirs := make([]string, 0, len(layout.repositories)+len(layout.projectors))
	for _, pkg := range layout.repositories {
		dirs = append(dirs, pkg.dir)
	}
	for _, pkg := range layout.projectors {
		dirs = append(dirs, pkg.dir)
	}
	layout.source = storageSource(root, dirs)

	return layout
}

func packagesUnder(root, base, kind string) []storagePackage {
	base = filepath.ToSlash(filepath.Clean(base))
	var out []storagePackage

	// An explicit migrations directory is also a complete schema input.
	if hasUpMigrations(root, base) {
		return []storagePackage{{name: path.Base(path.Dir(base)), dir: path.Dir(base), migrations: base}}
	}

	// A feature slice points directly at its repository adapter, with
	// migrations immediately below it.
	if hasUpMigrations(root, path.Join(base, "migrations")) {
		name := packageName(strings.Split(base, "/"), kind)
		if name == "" {
			name = path.Base(base)
		}
		return []storagePackage{{name: name, dir: base, migrations: path.Join(base, "migrations")}}
	}

	for _, child := range subdirs(root, base) {
		dir := path.Join(base, child)
		migrations := path.Join(dir, "migrations")
		if hasUpMigrations(root, migrations) {
			out = append(out, storagePackage{name: child, dir: dir, migrations: migrations})
		}
	}

	sortStoragePackages(out)
	return out
}

func discoverPackages(root, kind string) []storagePackage {
	base := filepath.Clean(root)
	seen := map[string]bool{}
	var out []storagePackage

	_ = filepath.WalkDir(base, func(filename string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if filename != base {
			switch entry.Name() {
			case "vendor", "node_modules", "testdata":
				return filepath.SkipDir
			}
			if _, err := os.Stat(filepath.Join(filename, "go.mod")); err == nil {
				return filepath.SkipDir
			}
		}
		if filename != base && strings.HasPrefix(entry.Name(), ".") {
			return filepath.SkipDir
		}
		if entry.Name() != "migrations" && entry.Name() != "migration" {
			return nil
		}

		rel, err := filepath.Rel(root, filename)
		if err != nil {
			return filepath.SkipDir
		}
		migrations := filepath.ToSlash(rel)
		if !hasUpMigrations(root, migrations) {
			return filepath.SkipDir
		}
		dir := path.Dir(migrations)
		parts := strings.Split(dir, "/")
		name := packageName(parts, kind)
		if name == "" && kind == "repository" && packageName(parts, "projector") == "" {
			name = path.Base(dir)
		}
		if name == "" || seen[dir] {
			return filepath.SkipDir
		}
		seen[dir] = true
		out = append(out, storagePackage{name: name, dir: dir, migrations: migrations})

		return filepath.SkipDir
	})

	sortStoragePackages(out)
	return out
}

// packageName accepts these shapes and ignores migrations belonging to the
// other adapter kind:
//
//	internal/infrastructure/repository/user
//	internal/user/infrastructure/repository
//	internal/user/infrastructure/projector/directory
func packageName(parts []string, kind string) string {
	for i, part := range parts {
		if part != kind {
			continue
		}
		if i+1 < len(parts) {
			return parts[i+1]
		}
		if i >= 2 && parts[i-1] == "infrastructure" {
			return parts[i-2]
		}
	}
	return ""
}

func hasUpMigrations(root, dir string) bool {
	entries, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(dir)))
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") && !strings.HasSuffix(entry.Name(), ".down.sql") {
			return true
		}
	}
	return false
}

func sortStoragePackages(packages []storagePackage) {
	sort.Slice(packages, func(i, j int) bool {
		if packages[i].name != packages[j].name {
			return packages[i].name < packages[j].name
		}
		return packages[i].dir < packages[j].dir
	})
}

func storageSource(root string, dirs []string) string {
	if len(dirs) == 0 {
		return ""
	}
	sort.Strings(dirs)
	if len(dirs) == 1 {
		return filepath.ToSlash(filepath.Join(root, filepath.FromSlash(dirs[0])))
	}

	parent := path.Dir(dirs[0])
	sameParent := true
	for _, dir := range dirs[1:] {
		if path.Dir(dir) != parent {
			sameParent = false
			break
		}
	}
	if sameParent {
		return filepath.ToSlash(filepath.Join(root, filepath.FromSlash(parent)))
	}

	parts := strings.Split(dirs[0], "/")
	for _, dir := range dirs[1:] {
		other := strings.Split(dir, "/")
		if len(other) != len(parts) {
			return filepath.ToSlash(filepath.Join(root, "internal"))
		}
		for i := range parts {
			if parts[i] != other[i] {
				parts[i] = "*"
			}
		}
	}

	return filepath.ToSlash(filepath.Join(root, filepath.FromSlash(strings.Join(parts, "/"))))
}

// mapSourceDir accepts both supported repository shapes: a collection root
// with one child package per aggregate, and a feature repository package that
// is already the aggregate's source directory.
func mapSourceDir(root, repositoryDir, aggregate string) string {
	child := path.Join(repositoryDir, aggregate)
	if info, err := os.Stat(filepath.Join(root, filepath.FromSlash(child))); err == nil && info.IsDir() {
		return child
	}

	return repositoryDir
}
