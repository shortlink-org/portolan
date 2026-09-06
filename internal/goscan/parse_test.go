package goscan

import (
	"go/ast"
	"go/parser"
)

// parseExpr is go/parser's, named here so a test reads as a table.
func parseExpr(src string) (ast.Expr, error) {
	return parser.ParseExpr(src)
}
