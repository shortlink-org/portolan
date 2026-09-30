package extractsql

import (
	"go/ast"
	"go/token"
	"path"
	"regexp"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// squirrel: a statement built call by call. What it does is the call that
// starts it - Select, Insert, Update, Delete - and the tables are the
// arguments of the calls that name one.
//
//	sq.Select("id").From("orders").Join("order_lines l ON ...")   read, read
//	psql.Insert("orders").Columns(...).Values(...)                write
//	sq.Update("orders").Set("state", s).From("carts")              write, read
//	sq.Delete("").From("order_lines")                              delete

var squirrelStarts = map[string]bool{"Select": true, "Insert": true, "Replace": true, "Update": true, "Delete": true}

var squirrelJoins = map[string]bool{"Join": true, "LeftJoin": true, "RightJoin": true, "InnerJoin": true, "CrossJoin": true, "FullJoin": true}

// relationHead is a table name at the start of a clause: orders, "orders",
// sales.orders; not a subquery or a LATERAL.
var relationHead = regexp.MustCompile(`^(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?$`)

func isSquirrelType(key string) bool {
	return strings.HasPrefix(key, squirrelPath+".")
}

// squirrelCall reads one chain from its outermost call; the calls inside it
// are marked so that each is read once.
func (s *site) squirrelCall(call *ast.CallExpr, consumed map[*ast.CallExpr]bool) {
	root, links := unroll(call)
	start, ok := s.squirrelStart(root, links, 0, map[string]bool{})
	if !ok {
		return
	}
	for _, l := range links {
		consumed[l.call] = true
	}

	for i, l := range links {
		if i < start {
			continue
		}
		var operation catalog.TableOperation
		switch {
		case squirrelStarts[l.name] && l.name != "Select":
			operation = squirrelOperation(l.name)
		case l.name == "Into" || l.name == "Table":
			operation = catalog.TableOperationWrite
		case l.name == "From":
			operation = catalog.TableOperationRead
			if s.squirrelKind(links, start) == "Delete" {
				operation = catalog.TableOperationDelete
			}
		case squirrelJoins[l.name]:
			operation = catalog.TableOperationRead
		default:
			continue
		}
		if len(l.call.Args) == 0 {
			continue
		}
		values, _ := s.strings(l.call.Args[0])
		if len(values) == 0 {
			s.p.warn("squirrel: the table given to " + l.name + " at " + s.at(l.call) + " is not a constant; the access is not recorded")
			continue
		}
		for _, value := range values {
			fields := strings.Fields(value)
			if len(fields) == 0 || !relationHead.MatchString(fields[0]) {
				continue
			}
			s.emit(call, fields[0], operation, librarySquirrel, true)
		}
	}
}

func squirrelOperation(start string) catalog.TableOperation {
	switch start {
	case "Delete":
		return catalog.TableOperationDelete
	case "Select":
		return catalog.TableOperationRead
	default:
		return catalog.TableOperationWrite
	}
}

// squirrelKind is the call that started the statement, or "" when the chain
// continues a builder started elsewhere.
func (s *site) squirrelKind(links []link, start int) string {
	for _, l := range links[start:] {
		if squirrelStarts[l.name] {
			return l.name
		}
	}
	return s.inheritedKind
}

// squirrelStart is where the builder begins in a chain: at the package
// (sq.Select), at its StatementBuilder, at a value typed as one of its
// builders, or at a local handed one earlier - whose starting call then says
// what a From in this chain means.
func (s *site) squirrelStart(root ast.Expr, links []link, depth int, visiting map[string]bool) (int, bool) {
	s.inheritedKind = ""
	if len(links) == 0 {
		return 0, false
	}
	if s.packageName(root) == squirrelPath {
		return 0, true
	}
	if sel, ok := root.(*ast.SelectorExpr); ok && s.packageName(sel.X) == squirrelPath {
		return 0, true
	}
	if start, ok := s.libraryStart(root, links, isSquirrelType); ok {
		return start, true
	}
	ident, ok := root.(*ast.Ident)
	if !ok || depth >= 3 || visiting[ident.Name] {
		return 0, false
	}
	if s.squirrelPackageVar(ident.Name) {
		return 0, true
	}
	visiting[ident.Name] = true
	defer delete(visiting, ident.Name)
	for _, value := range s.assigns[ident.Name] {
		if value.index != 0 {
			continue
		}
		valueRoot, valueLinks := unroll(value.expr)
		if self, ok := valueRoot.(*ast.Ident); ok && self.Name == ident.Name {
			continue
		}
		if at, ok := s.squirrelStart(valueRoot, valueLinks, depth+1, visiting); ok {
			kind := ""
			for _, l := range valueLinks[at:] {
				if squirrelStarts[l.name] {
					kind = l.name
				}
			}
			s.inheritedKind = kind
			return 0, true
		}
	}
	return 0, false
}

// squirrelPackageVar says whether a name is a package-level builder:
// var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar).
func (s *site) squirrelPackageVar(name string) bool {
	if s.fn.Types[name] != "" || s.locals[name] != "" || len(s.assigns[name]) > 0 {
		return false
	}
	for _, file := range s.p.idx.PackageFiles(path.Dir(s.file.Name)) {
		for _, decl := range file.Node.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.VAR {
				continue
			}
			for _, raw := range gen.Specs {
				spec := raw.(*ast.ValueSpec)
				for i, ident := range spec.Names {
					if ident.Name != name {
						continue
					}
					if spec.Type != nil {
						return isSquirrelType(s.p.idx.TypeKey(spec.Type, file))
					}
					if i >= len(spec.Values) {
						return false
					}
					root, _ := unroll(spec.Values[i])
					if sel, ok := root.(*ast.SelectorExpr); ok {
						root = sel.X
					}
					base, ok := root.(*ast.Ident)
					return ok && file.Imports[base.Name] == squirrelPath
				}
			}
		}
	}
	return false
}
