package goscan

import (
	"go/ast"
	"go/token"
	"strconv"
)

// indexConstants records every constant in the tree. A name in a const group
// with no value of its own takes the values of the line before it, the way
// the language does.
func (t *Tree) indexConstants() {
	for _, file := range t.Files {
		for _, decl := range file.Node.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			var inherited []ast.Expr
			for _, raw := range gen.Specs {
				spec := raw.(*ast.ValueSpec)
				values := spec.Values
				if len(values) == 0 {
					values = inherited
				} else {
					inherited = values
				}
				for i, name := range spec.Names {
					if len(values) > 0 {
						t.Constants[file.Pkg+"."+name.Name] = ConstExpr{Expr: values[min(i, len(values)-1)], File: file}
					}
				}
			}
		}
	}
}

// StringOf is the string an expression is worth: a literal; a constant of the
// tree, by its own name or through an import; or what Foreign says about a
// name from outside. Empty when it is none of those. visiting is the chain of
// constants being followed, so one defined in terms of itself ends rather
// than recurses; nil to start.
func (t *Tree) StringOf(expr ast.Expr, file *File, visiting map[string]bool) string {
	switch value := Unwrap(expr).(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, _ := strconv.Unquote(value.Value)
			return text
		}
	case *ast.Ident:
		return t.ConstantString(file.Pkg+"."+value.Name, visiting)
	case *ast.SelectorExpr:
		pkg, ok := value.X.(*ast.Ident)
		if !ok {
			return ""
		}
		imported := file.Imports[pkg.Name]
		if t.Foreign != nil {
			if known, ok := t.Foreign(imported, value.Sel.Name); ok {
				return known
			}
		}
		return t.ConstantString(imported+"."+value.Sel.Name, visiting)
	}
	return ""
}

// ConstantString is the string behind a constant, by "<import path>.<Name>",
// followed through whatever it was declared as.
func (t *Tree) ConstantString(key string, visiting map[string]bool) string {
	if visiting == nil {
		visiting = map[string]bool{}
	}
	if visiting[key] {
		return ""
	}
	found, ok := t.Constants[key]
	if !ok {
		return ""
	}
	visiting[key] = true
	value := t.StringOf(found.Expr, found.File, visiting)
	delete(visiting, key)
	return value
}
