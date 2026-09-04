package main

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pgplex/pgparser/nodes"
	pgsql "github.com/pgplex/pgparser/parser"
	"github.com/shortlink-org/portolan/plugin"
)

// The same fact read out of a repository written in TypeScript, where the
// statement and its arguments sit side by side in one call:
//
//	client.query(
//	  "INSERT INTO baskets (id, token, customer_id, touched_at) VALUES ($1, $2, $3, $4)",
//	  [basket.id, basket.token, basket.customerId, basket.touchedAt.toISOString()],
//	)
//
// There is no parser for the language here, and none is needed for this
// shape: the statement is a string literal, the arguments are an array
// literal right after it, and each argument is a property chain from the
// aggregate - possibly wrapped in one conversion. Anything else is left
// unmapped, for the same reason as in the Go reader: a blank is a reader
// looking the column up, a wrong one is a reader believing something untrue.
func readMapsTS(root, repositories, aggregate string, b *plugin.Builder) map[string]map[string]string {
	out := map[string]map[string]string{}
	dir := path.Join(repositories, aggregate)
	entries, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(dir)))
	if err != nil {
		return out
	}
	root_ := title(aggregate)

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".test.ts") || strings.HasSuffix(name, ".d.ts") {
			continue
		}
		source, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(dir), name))
		if err != nil {
			continue
		}
		for _, stmt := range insertCalls(string(source)) {
			table, columns, values := parseInsert(stmt.sql)
			if table == "" {
				continue
			}
			mapped := out[table]
			if mapped == nil {
				mapped = map[string]string{}
				out[table] = mapped
			}
			numbers := placeholderNumbers(stmt.sql)
			if numbers == nil || countParams(values) != len(numbers) {
				if countParams(values) > 0 {
					b.Warn(table, "the insert into "+table+" has placeholders this reader cannot number; its columns are left unmapped")
				}
				continue
			}
			seen := 0
			for i, column := range columns {
				if i >= len(values) {
					break
				}
				if _, ok := values[i].(*nodes.ParamRef); !ok {
					continue
				}
				number := numbers[seen]
				seen++
				if number < 1 || number > len(stmt.args) {
					b.Warn(table, "the insert refers to $"+itoa(number)+" but the call passes "+itoa(len(stmt.args))+" values; "+column+" is left unmapped")
					continue
				}
				field := fieldOfTS(stmt.args[number-1])
				if field == "" {
					continue
				}
				mapped[column] = root_ + "." + field
			}
		}
	}

	return out
}

// tsInsert is one statement and the array of arguments written after it.
type tsInsert struct {
	sql  string
	args []string
}

// insertCalls walks the source one character at a time, because a string
// literal can only be found by reading from its opening quote to its closing
// one: a pattern that skips ahead to the next quote it likes will start in
// one literal and end in another, and read the code between them as SQL.
// Comments are stepped over the same way. A literal that holds an INSERT and
// is followed by a comma and an array is a statement with its arguments.
func insertCalls(source string) []tsInsert {
	var out []tsInsert
	for i := 0; i < len(source); i++ {
		c := source[i]
		switch {
		case c == '/' && i+1 < len(source) && source[i+1] == '/':
			for i < len(source) && source[i] != '\n' {
				i++
			}
		case c == '/' && i+1 < len(source) && source[i+1] == '*':
			end := strings.Index(source[i+2:], "*/")
			if end < 0 {
				return out
			}
			i += 2 + end + 1
		case c == '"' || c == '\'' || c == '`':
			end := closingQuote(source, i)
			if end < 0 {
				return out
			}
			sql := source[i+1 : end]
			i = end
			j := skipSpace(source, end+1)
			if j >= len(source) || source[j] != ',' {
				continue
			}
			j = skipSpace(source, j+1)
			if j >= len(source) || source[j] != '[' || !strings.Contains(strings.ToUpper(sql), "INSERT INTO") {
				continue
			}
			close := matchingBracket(source, j)
			if close < 0 {
				continue
			}
			out = append(out, tsInsert{sql: sql, args: splitTopLevel(source[j+1 : close])})
			i = close
		}
	}

	return out
}

// closingQuote finds the quote that closes the one at open, stepping over
// escapes.
func closingQuote(source string, open int) int {
	quote := source[open]
	for i := open + 1; i < len(source); i++ {
		switch source[i] {
		case '\\':
			i++
		case quote:
			return i
		}
	}

	return -1
}

func skipSpace(source string, i int) int {
	for i < len(source) && (source[i] == ' ' || source[i] == '\t' || source[i] == '\n' || source[i] == '\r') {
		i++
	}

	return i
}

// matchingBracket finds the `]` that closes the `[` at open, stepping over
// nested brackets, parentheses, braces and string literals.
func matchingBracket(source string, open int) int {
	depth := 0
	var quote byte
	for i := open; i < len(source); i++ {
		c := source[i]
		if quote != 0 {
			if c == '\\' {
				i++
			} else if c == quote {
				quote = 0
			}
			continue
		}
		switch c {
		case '"', '\'', '`':
			quote = c
		case '[', '(', '{':
			depth++
		case ']', ')', '}':
			depth--
			if depth == 0 {
				return i
			}
		}
	}

	return -1
}

// splitTopLevel splits an argument list on the commas that are not inside a
// call, an object, an array or a string.
func splitTopLevel(list string) []string {
	var out []string
	depth := 0
	var quote byte
	start := 0
	for i := 0; i < len(list); i++ {
		c := list[i]
		if quote != 0 {
			if c == '\\' {
				i++
			} else if c == quote {
				quote = 0
			}
			continue
		}
		switch c {
		case '"', '\'', '`':
			quote = c
		case '[', '(', '{':
			depth++
		case ']', ')', '}':
			depth--
		case ',':
			if depth == 0 {
				out = append(out, strings.TrimSpace(list[start:i]))
				start = i + 1
			}
		}
	}
	if last := strings.TrimSpace(list[start:]); last != "" {
		out = append(out, last)
	}

	return out
}

var tsChain = regexp.MustCompile(`^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$`)

// fieldOfTS follows an argument back to the field it carries, the way fieldOf
// does for Go: `basket.customerId` is customerId, `basket.touchedAt.toISOString()`
// is touchedAt, `nullable(basket.checkedOutAt)` is checkedOutAt. A bare name,
// a literal, a call that makes its own value - `randomUUID()`, `new Date()` -
// and a call over several values carry no field.
func fieldOfTS(expr string) string {
	expr = strings.TrimSpace(expr)
	for strings.HasSuffix(expr, ")") {
		open := openingParen(expr)
		if open <= 0 {
			return ""
		}
		callee, inner := expr[:open], expr[open+1:len(expr)-1]
		args := splitTopLevel(inner)
		switch {
		case tsChain.MatchString(callee) && len(args) == 0:
			// A method on the value: the value is the chain before it.
			expr = callee[:strings.LastIndexAny(callee, ".")]
			expr = strings.TrimSuffix(expr, "?")
		case len(args) == 1:
			// A conversion wrapped round the value.
			expr = strings.TrimSpace(args[0])
		default:
			return ""
		}
	}
	if !tsChain.MatchString(expr) {
		return ""
	}
	parts := strings.Split(strings.ReplaceAll(expr, "?.", "."), ".")

	return strings.Join(parts[1:], ".")
}

// openingParen finds the `(` that the closing paren at the end of expr pairs
// with.
func openingParen(expr string) int {
	depth := 0
	for i := len(expr) - 1; i >= 0; i-- {
		switch expr[i] {
		case ')':
			depth++
		case '(':
			depth--
			if depth == 0 {
				return i
			}
		}
	}

	return -1
}

// parseInsert reads the table, its column list and its values out of one
// INSERT statement.
func parseInsert(sql string) (string, []string, []nodes.Node) {
	tree, err := pgsql.Parse(sql)
	if err != nil || len(tree.Items) == 0 {
		return "", nil, nil
	}
	insert, ok := tree.Items[0].(*nodes.InsertStmt)
	if !ok || insert.Relation == nil {
		return "", nil, nil
	}
	var columns []string
	for _, item := range items(insert.Cols) {
		if target, ok := item.(*nodes.ResTarget); ok {
			columns = append(columns, target.Name)
		}
	}

	return insert.Relation.Relname, columns, insertValues(insert)
}
