// Package goscan reads a Go source tree the way the extractors need it: every
// non-test, non-generated file parsed once, each with the import path of its
// package and its imports by local name, and the string constants of the tree
// indexed so that a topic, a queue or a subject named by a constant resolves to
// the literal behind it.
//
// It is the part of a Go extractor that has nothing to do with what the
// extractor is looking for. River and Watermill read the tree this way, and the
// next Go extractor should not have to copy it a third time.
package goscan

import (
	"fmt"
	"go/ast"
	"go/build"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

// ReadOptions controls a source snapshot. Generated declarations can be used
// for type/contract resolution without treating them as handwritten behavior.
type ReadOptions struct {
	IncludeGenerated bool
	AllowPartial     bool
	GOOS             string
	GOARCH           string
	Tags             []string
	// Directories restricts parsing to these module-relative directories.
	Directories []string
}

// Tree is one Go module's source, read once.
type Tree struct {
	Diagnostics []string
	ByDir       map[string][]*File
	Options     ReadOptions

	Root   string
	Module string
	Fset   *token.FileSet
	// Files in path order, so that whatever is read off them comes out in the
	// same order every run.
	Files []*File
	// Constants is every constant of the tree by "<import path>.<Name>", as
	// the expression that declared it, so a constant defined through another
	// is followed rather than copied.
	Constants map[string]ConstExpr
	// Foreign is what an identifier from a package outside the tree is worth,
	// when the extractor knows: river.QueueDefault is "default", and nothing
	// in the tree says so. Nil when there is nothing to say.
	Foreign func(importPath, name string) (string, bool)
}

// Read parses the tree under root. Test files, generated files, vendored
// code and dot-directories are left out: they are not what the service
// says about itself.
func Read(root string) (*Tree, error) { return ReadWithOptions(root, ReadOptions{}) }

func ReadWithOptions(root string, options ReadOptions) (*Tree, error) {
	root = filepath.Clean(root)
	t := &Tree{Root: root, Module: ModulePath(root), Fset: token.NewFileSet(), Constants: map[string]ConstExpr{}, ByDir: map[string][]*File{}, Options: options}
	buildContext := build.Default
	if options.GOOS != "" {
		buildContext.GOOS = options.GOOS
	} else if target := os.Getenv("GOOS"); target != "" {
		buildContext.GOOS = target
	}
	if options.GOARCH != "" {
		buildContext.GOARCH = options.GOARCH
	} else if target := os.Getenv("GOARCH"); target != "" {
		buildContext.GOARCH = target
	}
	buildContext.BuildTags = append([]string(nil), options.Tags...)
	// The WASI host supplies the target platform. Never silently analyze the
	// wasip1 runtime's file set when running the syntax extractor as a plugin.
	matchBuild := runtime.GOOS != "wasip1" || options.GOOS != "" || os.Getenv("GOOS") != ""
	allowed := map[string]bool{}
	for _, dir := range options.Directories {
		allowed[filepath.ToSlash(filepath.Clean(dir))] = true
	}

	var names []string
	err := filepath.WalkDir(root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name != root {
				if _, err := os.Stat(filepath.Join(name, "go.mod")); err == nil {
					return filepath.SkipDir
				}
			}
			if name != root && strings.HasPrefix(entry.Name(), ".") {
				return filepath.SkipDir
			}
			switch entry.Name() {
			case ".git", ".portolan", "node_modules", "vendor", "testdata":
				if name != root {
					return filepath.SkipDir
				}
			}
			return nil
		}
		base := entry.Name()
		if !strings.HasSuffix(base, ".go") || strings.HasSuffix(base, "_test.go") {
			return nil
		}
		rel, _ := filepath.Rel(root, filepath.Dir(name))
		if len(allowed) > 0 && !allowed[filepath.ToSlash(rel)] {
			return nil
		}
		if matchBuild {
			match, err := buildContext.MatchFile(filepath.Dir(name), base)
			if err != nil {
				return err
			}
			if !match {
				return nil
			}
		}
		if !options.IncludeGenerated && generatedName(base) {
			return nil
		}
		names = append(names, name)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(names)

	for _, name := range names {
		node, err := parser.ParseFile(t.Fset, name, nil, parser.ParseComments)
		if err != nil {
			if !options.AllowPartial {
				return nil, fmt.Errorf("parse %s: %w", name, err)
			}
			t.Diagnostics = append(t.Diagnostics, fmt.Sprintf("parse %s: %v", name, err))
			continue
		}
		generated := IsGenerated(name, node)
		if generated && !options.IncludeGenerated {
			continue
		}
		rel, _ := filepath.Rel(root, name)
		t.Files = append(t.Files, &File{
			Name:      filepath.ToSlash(rel),
			Generated: generated,
			Pkg:       t.PackagePath(filepath.Dir(name)),
			Imports:   ImportsOf(node),
			Node:      node,
		})
	}
	// Index actual local package names after all declarations are known.
	namesByImport := map[string]string{}
	for _, file := range t.Files {
		namesByImport[file.Pkg] = file.Node.Name.Name
		dir := filepath.ToSlash(filepath.Dir(file.Name))
		t.ByDir[dir] = append(t.ByDir[dir], file)
	}
	for _, file := range t.Files {
		for _, spec := range file.Node.Imports {
			if spec.Name != nil {
				continue
			}
			imported, _ := strconv.Unquote(spec.Path.Value)
			if name := namesByImport[imported]; name != "" {
				delete(file.Imports, path.Base(imported))
				file.Imports[name] = imported
			}
		}
	}
	t.indexConstants()

	return t, nil
}

// PackagePath is the import path of the package in dir: the module path
// with the directory under it.
func (t *Tree) PackagePath(dir string) string {
	rel, err := filepath.Rel(t.Root, dir)
	if err != nil || rel == "." {
		return t.Module
	}
	return strings.TrimSuffix(t.Module, "/") + "/" + filepath.ToSlash(rel)
}

// At is where a node is, relative to the root.
func (t *Tree) At(pos token.Pos) Source {
	position := t.Fset.Position(pos)
	rel, err := filepath.Rel(t.Root, position.Filename)
	if err != nil {
		rel = position.Filename
	}
	return Source{File: filepath.ToSlash(rel), Line: position.Line}
}

// ModulePath is what go.mod under root calls the module; the cleaned root
// when there is no go.mod to ask.
func ModulePath(root string) string {
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if value, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
				return strings.TrimSpace(value)
			}
		}
	}
	return filepath.ToSlash(filepath.Clean(root))
}

// ImportsOf is a file's imports by the name the file uses for them: the alias
// when there is one, the last path segment when there is not. Blank and dot
// imports keep the segment, since nothing in the file refers to them by name.
//
// A segment with a dot in it - `nats.go`, `yaml.v3` - is not a Go identifier,
// and the package behind it is called by what comes before the dot; that name
// is recorded too, since it is the one the file uses.
func ImportsOf(node *ast.File) map[string]string {
	out := map[string]string{}
	for _, spec := range node.Imports {
		value, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			continue
		}
		name := path.Base(value)
		if spec.Name != nil && spec.Name.Name != "_" && spec.Name.Name != "." {
			name = spec.Name.Name
		}
		out[name] = value
		if short, _, dotted := strings.Cut(name, "."); dotted && short != "" {
			out[short] = value
		}
	}
	return out
}

func generatedName(name string) bool {
	return strings.HasSuffix(name, ".gen.go") || strings.HasSuffix(name, "_generated.go") || strings.HasSuffix(name, ".generated.go")
}

func IsGenerated(name string, file *ast.File) bool {
	return generatedName(name) || ast.IsGenerated(file)
}

// PackageFiles and PackageDirs use the same immutable source selection in
// every consumer; repeated lookups reuse the AST and token positions.
func (t *Tree) PackageFiles(dir string) []*File {
	return t.ByDir[filepath.ToSlash(filepath.Clean(dir))]
}
func (t *Tree) PackageDirs(prefix string) []string {
	prefix = filepath.ToSlash(filepath.Clean(prefix))
	var dirs []string
	for dir := range t.ByDir {
		if prefix == "." || dir == prefix || strings.HasPrefix(dir, prefix+"/") {
			dirs = append(dirs, dir)
		}
	}
	sort.Strings(dirs)
	return dirs
}

// PackageIndex also serves small standalone readers and tests. Extractors
// should pass their request-scoped index to reuse parsing across passes.
func PackageIndex(root, dir string, indexes ...*Tree) (*Tree, error) {
	if len(indexes) > 0 && indexes[0] != nil {
		return indexes[0], nil
	}
	return ReadWithOptions(root, ReadOptions{IncludeGenerated: true, AllowPartial: true})
}
