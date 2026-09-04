package main

// The same fact read out of a repository written in Rust, where sqlx puts the
// statement first and the values after it, one `bind` each:
//
//	sqlx::query("INSERT INTO orders (id, customer_id, placed_at) VALUES ($1, $2, $3)")
//	    .bind(order.id)
//	    .bind(&order.customer_id)
//	    .bind(order.placed_at)
//
// or, in the checked macros, as arguments after the literal:
//
//	sqlx::query!("INSERT INTO orders (id, customer_id) VALUES ($1, $2)", order.id, order.customer_id)
//
// Read off the text like the TypeScript one, for the same reason: the
// statement is a string literal, the values are expressions right after it,
// and each is a field chain from the aggregate, possibly borrowed, possibly
// wrapped in one conversion. Anything else is left unmapped.

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pgplex/pgparser/nodes"
	"github.com/shortlink-org/portolan/plugin"
)

func readMapsRust(root, repositories, aggregate string, b *plugin.Builder) map[string]map[string]string {
	out := map[string]map[string]string{}
	dir := path.Join(repositories, aggregate)
	entries, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(dir)))
	if err != nil {
		return out
	}
	root_ := title(aggregate)
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".rs") {
			continue
		}
		source, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(dir), name))
		if err != nil {
			continue
		}
		for _, stmt := range rustInsertCalls(string(source)) {
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
					b.Warn(table, "the insert refers to $"+itoa(number)+" but the call binds "+itoa(len(stmt.args))+" values; "+column+" is left unmapped")
					continue
				}
				field := fieldOfRust(stmt.args[number-1])
				if field == "" {
					continue
				}
				mapped[column] = root_ + "." + field
			}
		}
	}

	return out
}

// rustInsertCalls walks the source the way insertCalls does, with what Rust
// adds to the reading: raw strings, `r"…"` and `r#"…"#`, which is how a long
// statement is usually written; char literals, `'x'` and `'\n'`; and a
// lifetime, `'a`, which opens no literal at all and must not be read as one.
// A literal that holds an INSERT is a statement, and its values are the
// `.bind(…)` chain after the call that holds it, or the arguments after it
// inside a macro.
func rustInsertCalls(source string) []tsInsert {
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
		case c == '\'':
			if end := charLiteralEnd(source, i); end > 0 {
				i = end
			}
		case c == '"', c == 'r' && rawStringAt(source, i):
			start, end, hashes := stringLiteral(source, i)
			if end < 0 {
				return out
			}
			sql := source[start:end]
			i = end + hashes
			if !strings.Contains(strings.ToUpper(sql), "INSERT INTO") {
				continue
			}
			j := skipSpace(source, i+1)
			if j >= len(source) {
				continue
			}
			if source[j] == ',' {
				// A trailing comma inside the call is not the start of the
				// macro's arguments: the next thing decides.
				j = skipSpace(source, j+1)
			}
			if j >= len(source) {
				continue
			}
			if source[j] == ')' {
				// The builder shape: the values are bound one at a time after
				// the call closes.
				args, last := bindChain(source, j+1)
				out = append(out, tsInsert{sql: sql, args: args})
				i = last
			} else {
				// The macro shape: the values are the rest of the call.
				args, close := argsUntilClose(source, j)
				out = append(out, tsInsert{sql: sql, args: args})
				i = close
			}
		}
	}

	return out
}

// rawStringAt says whether the `r` at i opens a raw string: `r"` or `r#…"`.
// An `r` inside a longer word, `order`, is not one, and the caller only asks
// about an `r` that is not preceded by an identifier character.
func rawStringAt(source string, i int) bool {
	if i > 0 && isIdent(source[i-1]) {
		return false
	}
	j := i + 1
	for j < len(source) && source[j] == '#' {
		j++
	}

	return j < len(source) && source[j] == '"'
}

// stringLiteral reads the literal opening at i and answers with the bounds of
// its content, the index of its closing quote, and how many `#` follow that
// quote for a raw string.
func stringLiteral(source string, i int) (int, int, int) {
	if source[i] == '"' {
		end := closingQuote(source, i)

		return i + 1, end, 0
	}
	hashes := 0
	j := i + 1
	for source[j] == '#' {
		hashes++
		j++
	}
	closer := `"` + strings.Repeat("#", hashes)
	end := strings.Index(source[j+1:], closer)
	if end < 0 {
		return 0, -1, 0
	}

	return j + 1, j + 1 + end, hashes
}

// charLiteralEnd is the index of the quote closing a char literal at i, or
// -1 when the quote at i is a lifetime's and closes nothing.
func charLiteralEnd(source string, i int) int {
	if i+2 < len(source) && source[i+1] == '\\' {
		end := strings.IndexByte(source[i+2:], '\'')
		if end < 0 {
			return -1
		}

		return i + 2 + end
	}
	if i+2 < len(source) && source[i+2] == '\'' {
		return i + 2
	}

	return -1
}

// argsUntilClose splits the arguments from i to the `)` that closes the call
// they are in, and answers with the index of that paren.
func argsUntilClose(source string, i int) ([]string, int) {
	depth := 0
	var quote byte
	for j := i; j < len(source); j++ {
		c := source[j]
		if quote != 0 {
			if c == '\\' {
				j++
			} else if c == quote {
				quote = 0
			}
			continue
		}
		switch c {
		case '"':
			quote = c
		case '[', '(', '{':
			depth++
		case ']', '}':
			depth--
		case ')':
			if depth == 0 {
				return splitTopLevel(source[i:j]), j
			}
			depth--
		}
	}

	return nil, len(source) - 1
}

// bindChain reads `.bind(x)` calls one after another from i, stepping over
// whitespace and comments between them, and answers with what each was
// handed and the index it stopped at.
func bindChain(source string, i int) ([]string, int) {
	var args []string
	last := i - 1
	for {
		j := skipSpaceAndComments(source, i)
		if !strings.HasPrefix(source[j:], ".bind(") {
			return args, last
		}
		open := j + len(".bind")
		close := matchingBracket(source, open)
		if close < 0 {
			return args, last
		}
		args = append(args, strings.TrimSpace(source[open+1:close]))
		last = close
		i = close + 1
	}
}

func skipSpaceAndComments(source string, i int) int {
	for {
		i = skipSpace(source, i)
		if strings.HasPrefix(source[i:], "//") {
			for i < len(source) && source[i] != '\n' {
				i++
			}
			continue
		}
		if strings.HasPrefix(source[i:], "/*") {
			end := strings.Index(source[i+2:], "*/")
			if end < 0 {
				return len(source)
			}
			i += 2 + end + 2
			continue
		}

		return i
	}
}

func isIdent(c byte) bool {
	return c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

var rustChain = regexp.MustCompile(`^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$`)

// fieldOfRust follows a bound value back to the field it carries, the way
// fieldOfTS does: `order.customer_id` is customer_id, `&order.customer_id`
// and `*order.version` the same, `order.status.as_str()` is status,
// `Some(order.placed_at)` and `i64::from(order.version)` are placed_at and
// version. A bare name, a literal, a call that makes its own value -
// `Uuid::new_v4()` - and a call over several values carry no field.
func fieldOfRust(expr string) string {
	expr = strings.TrimSpace(expr)
	expr = strings.TrimSuffix(expr, "?")
	for strings.HasPrefix(expr, "&") || strings.HasPrefix(expr, "*") {
		expr = strings.TrimSpace(strings.TrimLeft(expr, "&*"))
		expr = strings.TrimSpace(strings.TrimPrefix(expr, "mut "))
	}
	for strings.HasSuffix(expr, ")") {
		open := openingParen(expr)
		if open <= 0 {
			return ""
		}
		callee, inner := expr[:open], expr[open+1:len(expr)-1]
		args := splitTopLevel(inner)
		switch {
		case rustChain.MatchString(callee) && len(args) == 0:
			// A method on the value: the value is the chain before it.
			expr = callee[:strings.LastIndex(callee, ".")]
		case len(args) == 1:
			// A conversion wrapped round the value.
			return fieldOfRust(args[0])
		default:
			return ""
		}
	}
	if !rustChain.MatchString(expr) {
		return ""
	}
	parts := strings.Split(expr, ".")

	return strings.Join(parts[1:], ".")
}
