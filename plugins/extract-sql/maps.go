package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/pgplex/pgparser/nodes"
	pgsql "github.com/pgplex/pgparser/parser"

	"github.com/shortlink-org/portolan/plugin"
)

// Which domain field a column carries.
//
// This is the fact that makes a schema readable next to a model rather than
// beside it, and it is the one thing here that cannot be read off the layout.
// Column names do not carry it: `password_hash` is not `Password` by any rule
// that is not a guess, and a rule that guesses would be wrong quietly.
//
// What does carry it is the statement that writes the row:
//
//	`INSERT INTO users (id, email, password_hash, created_at, version)
//	 VALUES ($1, $2, $3, $4, 1)`,
//	u.ID, u.Email.String(), u.Password.String(), u.CreatedAt)
//
// Five columns, four arguments. The alignment is through the placeholders, not
// through the column order: `version` is written as a literal, and counting
// positions would have mapped it to a field it has nothing to do with.
//
// The rule is all-or-nothing per column. Either the chain from column to `$N`
// to argument to field is unambiguous, or the column gets no `maps` at all -
// a blank is a reader looking the column up themselves, and a wrong one is a
// reader believing something untrue.
func readMaps(root, repositories, aggregate string, b *plugin.Builder) map[string]map[string]string {
	out := map[string]map[string]string{}

	dir := path.Join(repositories, aggregate)
	entries, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(dir)))
	if err != nil {
		return out
	}

	// The root type is the one the aggregate's package is named after, which is
	// the same rule the domain extractor used to pick it.
	root_ := title(aggregate)
	fset := token.NewFileSet()

	files := make([]*ast.File, 0, len(entries))

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}

		file, err := parser.ParseFile(fset, filepath.Join(root, filepath.FromSlash(dir), name), nil, parser.SkipObjectResolution)
		if err != nil {
			continue
		}
		files = append(files, file)
	}

	// A statement is routinely assembled from a shared column list rather than
	// written whole, so the package's string constants are collected before
	// anything is read and folded into the literals that name them.
	constants := stringConstants(files)

	for _, file := range files {
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}

			table, sql, columns, values, args := readInsert(call, constants)
			if table == "" {
				return true
			}

			mapped := out[table]
			if mapped == nil {
				mapped = map[string]string{}
				out[table] = mapped
			}

			// The parser records that a value IS a placeholder but not which
			// one - ParamRef.Number comes back zero - so the numbers are read
			// off the text and paired with the placeholders in order. If the
			// two do not agree on how many there are, nothing is mapped:
			// mapping by position from a disagreement is how a column ends up
			// confidently pointing at the wrong field.
			numbers := placeholderNumbers(sql)
			if numbers == nil || countParams(values) != len(numbers) {
				if countParams(values) > 0 {
					b.Warn(table, "the insert into "+table+" has placeholders this reader cannot number; its columns are left unmapped")
				}

				return true
			}

			seen := 0
			for i, column := range columns {
				if i >= len(values) {
					break
				}

				if _, ok := values[i].(*nodes.ParamRef); !ok {
					// A literal, a default, an expression: written by the
					// statement rather than carried from the aggregate.
					continue
				}

				number := numbers[seen]
				seen++

				if number < 1 || number > len(args) {
					b.Warn(table, "the insert refers to $"+itoa(number)+" but the call passes "+itoa(len(args))+" values; "+column+" is left unmapped")

					continue
				}

				field := fieldOf(args[number-1])
				if field == "" {
					continue
				}
				mapped[column] = root_ + "." + field
			}

			return true
		})
	}

	return out
}

// readInsert pulls the parts out of a call whose argument is an INSERT: the
// table, its column list, the values written into it, and the arguments the
// placeholders stand for.
func readInsert(call *ast.CallExpr, constants map[string]string) (string, string, []string, []nodes.Node, []ast.Expr) {
	for i, arg := range call.Args {
		sql, ok := stringValue(arg, constants)
		if !ok || !strings.Contains(strings.ToUpper(sql), "INSERT INTO") {
			continue
		}

		tree, err := pgsql.Parse(sql)
		if err != nil || len(tree.Items) == 0 {
			return "", "", nil, nil, nil
		}

		insert, ok := tree.Items[0].(*nodes.InsertStmt)
		if !ok || insert.Relation == nil {
			return "", "", nil, nil, nil
		}

		var columns []string
		for _, item := range items(insert.Cols) {
			if target, ok := item.(*nodes.ResTarget); ok {
				columns = append(columns, target.Name)
			}
		}

		return insert.Relation.Relname, sql, columns, insertValues(insert), call.Args[i+1:]
	}

	return "", "", nil, nil, nil
}

// stringConstants collects the package's string constants, which is where a
// column list usually lives when a statement is not written whole.
func stringConstants(files []*ast.File) map[string]string {
	out := map[string]string{}

	for _, file := range files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}

			for _, spec := range gen.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range value.Names {
					if i >= len(value.Values) {
						break
					}
					if literal, ok := value.Values[i].(*ast.BasicLit); ok && literal.Kind == token.STRING {
						out[name.Name] = unquote(literal.Value)
					}
				}
			}
		}
	}

	return out
}

// stringValue folds an expression down to the string it is, following the
// concatenation and the constants a statement is commonly built from. Anything
// it cannot fold answers false, and the statement is left alone rather than
// read half-resolved.
func stringValue(expr ast.Expr, constants map[string]string) (string, bool) {
	switch value := expr.(type) {
	case *ast.BasicLit:
		if value.Kind != token.STRING {
			return "", false
		}

		return unquote(value.Value), true

	case *ast.Ident:
		text, known := constants[value.Name]

		return text, known

	case *ast.ParenExpr:
		return stringValue(value.X, constants)

	case *ast.BinaryExpr:
		if value.Op != token.ADD {
			return "", false
		}
		left, ok := stringValue(value.X, constants)
		if !ok {
			return "", false
		}
		right, ok := stringValue(value.Y, constants)
		if !ok {
			return "", false
		}

		return left + right, true
	}

	return "", false
}

// placeholderNumbers reads $1, $2 ... out of the values clause, in the order
// they are written.
//
// It exists because the grammar port keeps a placeholder as a node with no
// number on it. Taking the order of the nodes as the order of the arguments
// would be right for every statement written in ascending order and wrong,
// silently, for the one that is not.
func placeholderNumbers(sql string) []int {
	upper := strings.ToUpper(sql)

	at := strings.LastIndex(upper, "VALUES")
	if at < 0 {
		return nil
	}

	clause := sql[at:]
	if end := strings.Index(strings.ToUpper(clause), "RETURNING"); end >= 0 {
		clause = clause[:end]
	}
	if end := strings.Index(strings.ToUpper(clause), "ON CONFLICT"); end >= 0 {
		clause = clause[:end]
	}

	var out []int
	for _, match := range placeholder.FindAllStringSubmatch(clause, -1) {
		number, err := strconv.Atoi(match[1])
		if err != nil {
			return nil
		}
		out = append(out, number)
	}

	return out
}

var placeholder = regexp.MustCompile(`\$(\d+)`)

func countParams(values []nodes.Node) int {
	n := 0
	for _, value := range values {
		if _, ok := value.(*nodes.ParamRef); ok {
			n++
		}
	}

	return n
}

// insertValues is the single VALUES row of an insert. An insert from a SELECT,
// or one writing more than one row, is not read: the first has no per-column
// argument to find and the second would need every row to agree.
func insertValues(insert *nodes.InsertStmt) []nodes.Node {
	source, ok := insert.SelectStmt.(*nodes.SelectStmt)
	if !ok {
		return nil
	}

	rows := items(source.ValuesLists)
	if len(rows) != 1 {
		return nil
	}

	row, ok := rows[0].(*nodes.List)
	if !ok {
		return nil
	}

	return row.Items
}

// fieldOf reads the field an argument came from: `u.ID` is ID, and
// `u.Email.String()` is Email, because what the column carries is the value
// object, not the conversion applied to it on the way out.
//
// The first selector standing on a plain identifier wins. Anything with no
// such selector - a local variable, a function of several fields, a literal -
// answers empty, and the column stays unmapped.
func fieldOf(arg ast.Expr) string {
	for {
		switch expr := arg.(type) {
		case *ast.CallExpr:
			// Two shapes hide the field in different places, and they look
			// alike: `u.Email.String()` reads it off its receiver, while
			// `pgtype.Text(u.Email)` takes it as an argument. What tells them
			// apart without a type checker is the depth of the selector - a
			// method on a field stands on another selector, a package function
			// stands on a bare name.
			if method, ok := expr.Fun.(*ast.SelectorExpr); ok {
				if _, nested := method.X.(*ast.SelectorExpr); nested {
					arg = expr.Fun

					continue
				}
			}

			// Otherwise the value came through the call, and only an argument
			// of exactly one says which field: a function of two has no single
			// field to name, and one of none has no field at all.
			if len(expr.Args) != 1 {
				return ""
			}
			arg = expr.Args[0]
		case *ast.SelectorExpr:
			if _, ok := expr.X.(*ast.Ident); ok {
				return expr.Sel.Name
			}
			arg = expr.X
		case *ast.UnaryExpr:
			arg = expr.X
		case *ast.ParenExpr:
			arg = expr.X
		default:
			return ""
		}
	}
}

// unquote handles both spellings a Go string literal comes in. The statements
// here are raw-quoted because they span lines, but a short one need not be.
// title is the type a package is named after: user becomes User,
// price_list becomes PriceList.
func title(name string) string {
	var b strings.Builder
	for _, word := range strings.FieldsFunc(name, func(r rune) bool { return r == '_' || r == '-' }) {
		runes := []rune(word)
		if runes[0] >= 'a' && runes[0] <= 'z' {
			runes[0] = runes[0] - 'a' + 'A'
		}
		b.WriteString(string(runes))
	}

	return b.String()
}

func itoa(n int) string { return strconv.Itoa(n) }

func unquote(literal string) string {
	if len(literal) >= 2 {
		if literal[0] == '`' || literal[0] == '"' {
			return literal[1 : len(literal)-1]
		}
	}

	return literal
}
