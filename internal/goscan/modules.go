package goscan

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/mod/modfile"
)

// modules is where a tree finds a package outside itself: the `replace`
// directives of its go.mod that point at a directory, and the trees already
// read through them.
//
// Only a directory is followed. A replace to another version, and every
// requirement without one, lives in the module cache, which is outside the
// workspace a plugin is handed (portolan.0006) - so a type from there stays
// what the source spells, rather than a guess at what the cache would say.
type modules struct {
	mu      sync.Mutex
	replace map[string]string // module path -> directory, cleaned
	trees   map[string]*Tree  // "<module dir>|<package dir>" -> tree
}

func readModules(root string) *modules {
	m := &modules{replace: map[string]string{}, trees: map[string]*Tree{}}
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		return m
	}
	file, err := modfile.Parse(filepath.Join(root, "go.mod"), data, nil)
	if err != nil {
		return m
	}
	for _, rep := range file.Replace {
		if rep.New.Version != "" || !modfile.IsDirectoryPath(rep.New.Path) {
			continue
		}
		dir := rep.New.Path
		if !filepath.IsAbs(dir) {
			dir = filepath.Join(root, dir)
		}
		m.replace[rep.Old.Path] = filepath.Clean(dir)
	}
	return m
}

// Locate is the tree and the directory in it that hold the package at an
// import path: this tree when the path is under its module, a tree read from
// a `replace` directory when one covers it. False when neither does, or the
// directory holds no Go files - the standard library, a dependency in the
// module cache, a package that is not there.
func (t *Tree) Locate(importPath string) (*Tree, string, bool) {
	if rel, ok := under(importPath, t.Module); ok {
		if len(t.PackageFiles(rel)) == 0 {
			return nil, "", false
		}
		return t, rel, true
	}
	if t.modules == nil {
		return nil, "", false
	}

	module, dir := "", ""
	for path, target := range t.modules.replace {
		if _, ok := under(importPath, path); ok && len(path) > len(module) {
			module, dir = path, target
		}
	}
	if module == "" {
		return nil, "", false
	}
	rel, _ := under(importPath, module)

	key := dir + "|" + rel
	t.modules.mu.Lock()
	defer t.modules.mu.Unlock()
	if foreign, seen := t.modules.trees[key]; seen {
		if foreign == nil {
			return nil, "", false
		}
		return foreign, rel, true
	}
	options := t.Options
	options.Directories = []string{rel}
	options.AllowPartial = true
	foreign, err := ReadWithOptions(dir, options)
	if err != nil || len(foreign.PackageFiles(rel)) == 0 {
		t.modules.trees[key] = nil
		return nil, "", false
	}
	// The module path is the one the importer knows it by. A replacement
	// directory whose go.mod says otherwise, or that has none, is still that
	// module to the go command, so its packages and constants are keyed so.
	if foreign.Module != module {
		foreign.Module = module
		for _, file := range foreign.Files {
			file.Pkg = foreign.PackagePath(filepath.Join(foreign.Root, filepath.FromSlash(filepath.Dir(file.Name))))
		}
		foreign.Constants = map[string]ConstExpr{}
		foreign.indexConstants()
	}
	t.modules.trees[key] = foreign
	return foreign, rel, true
}

// under is the directory of an import path below a module path, "." for the
// module's own root package.
func under(importPath, module string) (string, bool) {
	if module == "" {
		return "", false
	}
	if importPath == module {
		return ".", true
	}
	if rest, ok := strings.CutPrefix(importPath, strings.TrimSuffix(module, "/")+"/"); ok && rest != "" {
		return rest, true
	}
	return "", false
}
