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
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Tree is one Go module's source, read once.
type Tree struct {
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
func Read(root string) (*Tree, error) {
	t := &Tree{Root: root, Module: ModulePath(root), Fset: token.NewFileSet(), Constants: map[string]ConstExpr{}}

	var names []string
	err := filepath.WalkDir(root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name != root && strings.HasPrefix(entry.Name(), ".") {
				return filepath.SkipDir
			}
			switch entry.Name() {
			case ".git", ".portolan", "node_modules", "vendor":
				if name != root {
					return filepath.SkipDir
				}
			}
			return nil
		}
		base := entry.Name()
		if !strings.HasSuffix(base, ".go") || strings.HasSuffix(base, "_test.go") || strings.HasSuffix(base, ".gen.go") || strings.HasSuffix(base, "_generated.go") {
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
			return nil, fmt.Errorf("parse %s: %w", name, err)
		}
		rel, _ := filepath.Rel(root, name)
		t.Files = append(t.Files, &File{
			Name:    filepath.ToSlash(rel),
			Pkg:     t.PackagePath(filepath.Dir(name)),
			Imports: ImportsOf(node),
			Node:    node,
		})
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
	}
	return out
}
