package extractsql

import (
	"go/ast"
	"go/token"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"

	"github.com/shortlink-org/portolan/internal/goscan"
)

// table accesses are read from runtime SQL rather than from migrations. The
// migration proves that a table exists; a client call inside a repository
// method proves who reads or writes it.
type foundTableAccess struct {
	table  string
	access catalog.TableAccess
}

func readTableAccesses(root, repositoryDir, aggregate string, indexes ...*goscan.Tree) map[string][]catalog.TableAccess {
	dir := mapSourceDir(root, repositoryDir, aggregate)
	index, err := goscan.PackageIndex(root, dir, indexes...)
	if err != nil {
		return nil
	}
	fset := index.Fset
	var files []*ast.File
	for _, file := range index.PackageFiles(dir) {
		files = append(files, file.Node)
	}

	constants := stringConstants(files)
	callers := sqlMethodCallers(files)
	out := map[string][]catalog.TableAccess{}
	seen := map[string]bool{}
	for _, file := range files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			method := sqlMethodName(fn)
			visibleMethods := outermostSQLMethods(method, callers)
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				for _, arg := range call.Args {
					sql, static := partialStringValue(arg, constants)
					if !static {
						continue
					}
					position := fset.Position(call.Pos())
					source := filepath.ToSlash(filepath.Join(root, filepath.FromSlash(dir), filepath.Base(position.Filename))) + ":" + itoa(position.Line)
					for _, found := range sqlTableAccesses(sql, method, source) {
						for _, visibleMethod := range visibleMethods {
							found.access.Method = visibleMethod
							key := found.table + "\x00" + string(found.access.Operation) + "\x00" + found.access.Method + "\x00" + found.access.Source
							if seen[key] {
								continue
							}
							seen[key] = true
							out[found.table] = append(out[found.table], found.access)
						}
					}
				}
				return true
			})
		}
	}

	return out
}

// Internal helpers are an implementation detail of the adapter. If Save calls
// insert, the useful answer to "who writes this table?" is Save; if ByID and
// ByEmail share one, both public repository methods are readers. This tiny call
// graph follows calls on the same receiver and keeps the concrete SQL line as
// the source proof.
func sqlMethodCallers(files []*ast.File) map[string][]string {
	out := map[string][]string{}
	for _, file := range files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil || fn.Recv == nil || len(fn.Recv.List) == 0 || len(fn.Recv.List[0].Names) == 0 {
				continue
			}
			typeName := sqlReceiverName(fn.Recv.List[0].Type)
			receiver := fn.Recv.List[0].Names[0].Name
			caller := typeName + "." + fn.Name.Name
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				base, ok := sel.X.(*ast.Ident)
				if !ok || base.Name != receiver {
					return true
				}
				callee := typeName + "." + sel.Sel.Name
				if callee != caller && !containsString(out[callee], caller) {
					out[callee] = append(out[callee], caller)
				}
				return true
			})
		}
	}
	return out
}

func outermostSQLMethods(method string, callers map[string][]string) []string {
	seen := map[string]bool{}
	var roots []string
	var visit func(string)
	visit = func(current string) {
		if seen[current] {
			return
		}
		seen[current] = true
		parents := callers[current]
		if len(parents) == 0 {
			roots = append(roots, current)
			return
		}
		for _, parent := range parents {
			visit(parent)
		}
	}
	visit(method)
	if len(roots) == 0 {
		return []string{method}
	}
	sort.Strings(roots)
	return roots
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func sqlMethodName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return fn.Name.Name
	}
	return sqlReceiverName(fn.Recv.List[0].Type) + "." + fn.Name.Name
}

func sqlReceiverName(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.StarExpr:
		return sqlReceiverName(value.X)
	case *ast.IndexExpr:
		return sqlReceiverName(value.X)
	case *ast.IndexListExpr:
		return sqlReceiverName(value.X)
	case *ast.SelectorExpr:
		return value.Sel.Name
	case *ast.Ident:
		return value.Name
	default:
		return "repository"
	}
}

// partialStringValue keeps the literal parts of a concatenation even when a
// suffix is supplied by a parameter. `SELECT ... FROM users ` + where still
// proves the table and operation; treating the unknown suffix as whitespace
// keeps it from accidentally joining two tokens into a different statement.
func partialStringValue(expr ast.Expr, constants map[string]string) (string, bool) {
	switch value := expr.(type) {
	case *ast.BasicLit:
		if value.Kind != token.STRING {
			return "", false
		}
		return unquote(value.Value), true
	case *ast.Ident:
		text, ok := constants[value.Name]
		return text, ok
	case *ast.ParenExpr:
		return partialStringValue(value.X, constants)
	case *ast.BinaryExpr:
		if value.Op != token.ADD {
			return "", false
		}
		left, leftStatic := partialStringValue(value.X, constants)
		right, rightStatic := partialStringValue(value.Y, constants)
		if !leftStatic && !rightStatic {
			return "", false
		}
		return left + " " + right, true
	default:
		return "", false
	}
}

var (
	insertTarget = regexp.MustCompile(`(?is)\bINSERT\s+INTO\s+((?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_$]*))?)`)
	updateTarget = regexp.MustCompile(`(?is)\bUPDATE\s+((?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_$]*))?)\s+SET\b`)
	deleteTarget = regexp.MustCompile(`(?is)\bDELETE\s+FROM\s+((?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_$]*))?)`)
	readTarget   = regexp.MustCompile(`(?is)\b(?:FROM|JOIN)\s+((?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_$]*))?)`)
)

func sqlTableAccesses(sql, method, source string) []foundTableAccess {
	type target struct {
		name      string
		operation catalog.TableOperation
	}
	var targets []target
	add := func(match []int, operation catalog.TableOperation) {
		if match == nil {
			return
		}
		targets = append(targets, target{name: sqlRelationName(sql[match[2]:match[3]]), operation: operation})
	}
	add(insertTarget.FindStringSubmatchIndex(sql), catalog.TableOperationWrite)
	add(updateTarget.FindStringSubmatchIndex(sql), catalog.TableOperationWrite)
	deleted := deleteTarget.FindStringSubmatchIndex(sql)
	add(deleted, catalog.TableOperationDelete)

	for _, match := range readTarget.FindAllStringSubmatchIndex(sql, -1) {
		// DELETE's target is changed, not read. Other FROM/JOIN relations in a
		// compound write remain genuine reads and are kept.
		if deleted != nil && match[2] == deleted[2] && match[3] == deleted[3] {
			continue
		}
		targets = append(targets, target{name: sqlRelationName(sql[match[2]:match[3]]), operation: catalog.TableOperationRead})
	}

	seen := map[string]bool{}
	out := make([]foundTableAccess, 0, len(targets))
	for _, target := range targets {
		if target.name == "" {
			continue
		}
		key := target.name + "\x00" + string(target.operation)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, foundTableAccess{
			table: target.name,
			access: catalog.TableAccess{
				Operation: target.operation,
				Method:    method,
				Source:    source,
			},
		})
	}
	return out
}

func sqlRelationName(raw string) string {
	parts := strings.Split(raw, ".")
	for i := range parts {
		parts[i] = strings.Trim(strings.TrimSpace(parts[i]), `"`)
	}
	return strings.Join(parts, ".")
}

func mergeTableAccesses(into map[string][]catalog.TableAccess, more map[string][]catalog.TableAccess) {
	for table, accesses := range more {
		into[table] = append(into[table], accesses...)
	}
}

func attachTableAccesses(tables []catalog.Table, accesses map[string][]catalog.TableAccess) {
	for i := range tables {
		tables[i].Accesses = append([]catalog.TableAccess(nil), forTable(accesses, tables[i].Name)...)
		sort.SliceStable(tables[i].Accesses, func(a, b int) bool {
			left, right := tables[i].Accesses[a], tables[i].Accesses[b]
			if left.Operation != right.Operation {
				return tableOperationOrder(left.Operation) < tableOperationOrder(right.Operation)
			}
			if left.Method != right.Method {
				return left.Method < right.Method
			}
			return left.Source < right.Source
		})
	}
}

func tableOperationOrder(operation catalog.TableOperation) int {
	switch operation {
	case catalog.TableOperationRead:
		return 0
	case catalog.TableOperationWrite:
		return 1
	case catalog.TableOperationDelete:
		return 2
	default:
		return 3
	}
}
