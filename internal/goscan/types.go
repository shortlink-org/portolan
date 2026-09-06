package goscan

import (
	"bytes"
	"go/ast"
	"go/printer"
	"reflect"
	"strconv"
	"strings"
)

// Unwrap takes the parentheses, the address-of and the pointer off an
// expression, down to the thing itself.
func Unwrap(expr ast.Expr) ast.Expr {
	for {
		switch value := expr.(type) {
		case *ast.ParenExpr:
			expr = value.X
		case *ast.UnaryExpr:
			expr = value.X
		case *ast.StarExpr:
			expr = value.X
		default:
			return expr
		}
	}
}

// TypeKey names a type the way the tree indexes types: "<import path>.<Name>"
// for a named type, whether written bare or through an import; the builtin's
// own name; "[]T" and "map[K]V" over their parts; "interface" for any
// interface literal. Empty for a type this reader does not name.
func (t *Tree) TypeKey(expr ast.Expr, file *File) string {
	if expr == nil {
		return ""
	}
	switch value := Unwrap(expr).(type) {
	case *ast.Ident:
		if IsBuiltin(value.Name) {
			return value.Name
		}
		return file.Pkg + "." + value.Name
	case *ast.SelectorExpr:
		if base, ok := value.X.(*ast.Ident); ok {
			return file.Imports[base.Name] + "." + value.Sel.Name
		}
	case *ast.ArrayType:
		return "[]" + t.TypeKey(value.Elt, file)
	case *ast.MapType:
		return "map[" + t.TypeKey(value.Key, file) + "]" + t.TypeKey(value.Value, file)
	case *ast.InterfaceType:
		return "interface"
	}
	return ""
}

// IsBuiltin is whether a bare identifier is one of the language's own types.
func IsBuiltin(name string) bool {
	switch name {
	case "string", "bool", "byte", "rune", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "float32", "float64", "error", "any":
		return true
	}
	return false
}

// FieldsOf lists a struct's named fields as "name type", the name being what
// the json tag says when it says anything, and a field tagged "-" left out:
// the fields as they travel, not as the code calls them.
func (t *Tree) FieldsOf(body *ast.StructType) []string {
	var out []string
	for _, field := range body.Fields.List {
		if len(field.Names) == 0 {
			continue
		}
		typeName := t.PrintNode(field.Type)
		for _, ident := range field.Names {
			name := ident.Name
			if field.Tag != nil {
				tagText, _ := strconv.Unquote(field.Tag.Value)
				jsonName := strings.Split(reflect.StructTag(tagText).Get("json"), ",")[0]
				if jsonName == "-" {
					continue
				}
				if jsonName != "" {
					name = jsonName
				}
			}
			out = append(out, name+" "+typeName)
		}
	}
	return out
}

// PrintNode is a node as source text.
func (t *Tree) PrintNode(node ast.Node) string {
	var out bytes.Buffer
	_ = printer.Fprint(&out, t.Fset, node)
	return out.String()
}
