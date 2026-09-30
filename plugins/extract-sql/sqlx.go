package extractsql

import (
	"go/ast"
	"strings"

	"github.com/shortlink-org/portolan/internal/goscan"
)

// sqlx: the statement is a string argument, at a position fixed by the
// method. Where it is is read off the method name only once the file imports
// sqlx and what the call is made on is not typed as something else.
//
//	r.db.GetContext(ctx, &order, selectOrder, id)
//	sqlx.Select(r.db, &orders, "SELECT ... FROM orders")
//	r.db.NamedExecContext(ctx, insertOrder, order)

// sqlxMethods is where the statement is among a DB's, a Tx's or a Conn's
// arguments.
var sqlxMethods = map[string]int{
	"Get": 1, "Select": 1, "GetContext": 2, "SelectContext": 2,
	"Queryx": 0, "QueryRowx": 0, "QueryxContext": 1, "QueryRowxContext": 1,
	"NamedExec": 0, "NamedQuery": 0, "NamedExecContext": 1, "NamedQueryContext": 1,
	"MustExec": 0, "MustExecContext": 1,
	"Exec": 0, "ExecContext": 1, "Query": 0, "QueryContext": 1, "QueryRow": 0, "QueryRowContext": 1,
	"Preparex": 0, "PreparexContext": 1, "PrepareNamed": 0, "PrepareNamedContext": 1,
}

// sqlxFunctions is the same for the package's functions, which take the
// database as an argument.
var sqlxFunctions = map[string]int{
	"Get": 2, "Select": 2, "GetContext": 3, "SelectContext": 3,
	"NamedExec": 1, "NamedExecContext": 2, "NamedQuery": 1, "NamedQueryContext": 2,
	"MustExec": 1, "MustExecContext": 2, "Preparex": 1, "PreparexContext": 2,
}

func (s *site) sqlxCall(call *ast.CallExpr) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	var position int
	// strict is a call proved to be sqlx's: a statement it cannot resolve is
	// then reported rather than passed over.
	strict := false
	if s.packageName(sel.X) == sqlxPath {
		position, ok = sqlxFunctions[sel.Sel.Name]
		if !ok {
			return
		}
		strict = true
	} else {
		position, ok = sqlxMethods[sel.Sel.Name]
		if !ok || s.packageName(sel.X) != "" {
			return
		}
		switch key := s.typeOf(sel.X); {
		case strings.HasPrefix(key, sqlxPath+"."):
			switch strings.TrimPrefix(key, sqlxPath+".") {
			case "Stmt", "NamedStmt":
				// A prepared statement was given its SQL where it was prepared.
				return
			}
			strict = true
		case s.p.idx.Interfaces[key] != nil:
			// A port the adapter declares over its database - when its
			// methods are sqlx's. A cache's Get is not a query.
			if !sqlxShaped(s.p.idx.Interfaces[key]) {
				return
			}
		case s.declared(key):
			// A struct of the tree runs sqlx's method only by embedding a
			// sqlx handle, and not when it declares one of that name itself.
			if s.p.idx.Method(key, sel.Sel.Name) != nil || !embedsSqlx(s.p.idx.Structs[key]) {
				return
			}
		case key == "", key == "interface":
			if !s.imported[librarySqlx] {
				return
			}
		default:
			return
		}
	}
	if position >= len(call.Args) {
		return
	}
	values, built := s.strings(call.Args[position])
	if len(values) == 0 {
		if strict && !built {
			s.p.warn("sqlx: the statement given to " + sel.Sel.Name + " at " + s.at(call) + " is not a constant; the access is not recorded")
		}
		return
	}
	for _, sql := range values {
		s.emitSQL(call, sql, librarySqlx)
	}
}

func embedsSqlx(st *goscan.StructType) bool {
	if st == nil {
		return false
	}
	for _, embedded := range st.Embedded {
		if strings.HasPrefix(embedded, sqlxPath+".") {
			return true
		}
	}
	return false
}

// sqlxOnly are the methods no database handle but sqlx's has.
var sqlxOnly = map[string]bool{
	"Queryx": true, "QueryxContext": true, "QueryRowx": true, "QueryRowxContext": true,
	"NamedExec": true, "NamedExecContext": true, "NamedQuery": true, "NamedQueryContext": true,
	"MustExec": true, "MustExecContext": true, "Rebind": true, "BindNamed": true,
	"Preparex": true, "PreparexContext": true, "PrepareNamed": true, "PrepareNamedContext": true,
}

// sqlxShaped says whether an interface the tree declares is a sqlx handle:
// one that asks for a method only sqlx has, or for both Get and Select, or
// that is made only of interfaces from outside the tree (sqlx.ExtContext).
func sqlxShaped(methods []string) bool {
	if len(methods) == 0 {
		return true
	}
	get, sel := false, false
	for _, name := range methods {
		if sqlxOnly[name] {
			return true
		}
		get = get || name == "Get" || name == "GetContext"
		sel = sel || name == "Select" || name == "SelectContext"
	}
	return get && sel
}
