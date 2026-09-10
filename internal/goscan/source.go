package goscan

import (
	"fmt"
	"go/ast"
)

// Source is a place in the tree, the way the catalog cites one: the file
// relative to the root, and the line when there is one.
type Source struct {
	File string
	Line int
}

func (s Source) String() string {
	if s.Line == 0 {
		return s.File
	}
	return fmt.Sprintf("%s:%d", s.File, s.Line)
}

// File is one parsed file: its path under the root, the import path of its
// package, its imports by local name, and the syntax.
type File struct {
	Generated bool
	Name      string
	Pkg       string
	Imports   map[string]string
	Node      *ast.File
}

// ConstExpr is a constant as it was declared: the expression, and the file it
// is in, since the expression's names mean what that file's imports say.
type ConstExpr struct {
	Expr ast.Expr
	File *File
}
