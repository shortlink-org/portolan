package extractsql

import (
	"go/ast"
	"go/parser"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/plugin"
)

func builderFor(t *testing.T) *plugin.Builder {
	t.Helper()

	return &plugin.Builder{}
}

func expr(t *testing.T, src string) ast.Expr {
	t.Helper()

	parsed, err := parser.ParseExpr(src)
	if err != nil {
		t.Fatal(err)
	}

	return parsed
}

// The column carries the value object, not the conversion applied to it on the
// way out - and the conversion is written both ways round.
func TestFieldOfFollowsBothCallShapes(t *testing.T) {
	s := scope{packages: map[string]bool{"time": true, "pgtype": true, "uuid": true}}
	cases := map[string]string{
		"u.ID":                       "ID",
		"u.Email.String()":           "Email",
		"nullable(s.RevokedAt)":      "RevokedAt",
		"pgtype.Text(u.Email)":       "Email",
		"time.Now()":                 "",
		"uuid.NewString()":           "",
		"combine(u.A, u.B)":          "",
		"localVariable":              "",
		`"literal"`:                  "",
		"q.ID()":                     "ID",
		"q.Total().AmountMinor()":    "Total",
		"q.Total().Currency()":       "Total",
		"q.IssuedAt().Format(\"x\")": "IssuedAt",
	}

	for src, want := range cases {
		if got := fieldOf(expr(t, src), s); got != want {
			t.Errorf("fieldOf(%s) = %q, want %q", src, got, want)
		}
	}
}

// Inside Save the aggregate is the parameter typed as the root, and nothing
// else: the loop variable over its lines carries the line's fields, and a
// mapping from those to the aggregate would be a claim about the wrong type.
func TestFieldOfReadsOnlyTheRootWhenTheFunctionNamesIt(t *testing.T) {
	s := scope{packages: map[string]bool{}, roots: map[string]bool{"q": true}}
	cases := map[string]string{
		"q.ID()":        "ID",
		"q.BasketID()":  "BasketID",
		"l.SKU()":       "",
		"l.Quantity":    "",
		"raised.Name()": "",
	}

	for src, want := range cases {
		if got := fieldOf(expr(t, src), s); got != want {
			t.Errorf("fieldOf(%s) = %q, want %q", src, got, want)
		}
	}
}

// The variable of a range loop stands for one element of what it walks, so a
// column written from it carries a field of the elements of a field.
func TestFieldOfFollowsARangeVariable(t *testing.T) {
	s := scope{
		packages: map[string]bool{},
		roots:    map[string]bool{"q": true},
		aliases:  map[string]ast.Expr{"l": expr(t, "q.Lines()"), "raised": expr(t, "events"), "l2": expr(t, "l2.Items")},
	}
	cases := map[string]string{
		"l.SKU()":                  "Lines.SKU",
		"l.UnitPrice().Currency()": "Lines.UnitPrice",
		"raised.Name()":            "",
		"l2.Name":                  "",
	}

	for src, want := range cases {
		if got := fieldOf(expr(t, src), s); got != want {
			t.Errorf("fieldOf(%s) = %q, want %q", src, got, want)
		}
	}
}

// Pricing keeps its fields unexported and writes rows off getters, and its
// lines are written from a loop variable over them.
func TestMapsThroughGetters(t *testing.T) {
	b := builderFor(t)
	mapped := readMaps("../../examples/shop/pricing", "internal/infrastructure/repository/quote", "quote", b)

	want := map[string]map[string]string{
		"quotes": {
			"id":          "Quote.ID",
			"basket_id":   "Quote.BasketID",
			"total_minor": "Quote.Total",
			"currency":    "Quote.Total",
			"state":       "Quote.State",
			"issued_at":   "Quote.IssuedAt",
			"expires_at":  "Quote.ExpiresAt",
		},
		"quote_lines": {
			"quote_id":         "Quote.ID",
			"sku":              "Quote.Lines.SKU",
			"quantity":         "Quote.Lines.Quantity",
			"unit_price_minor": "Quote.Lines.UnitPrice",
			"currency":         "Quote.Lines.UnitPrice",
		},
	}
	for table, columns := range want {
		for column, field := range columns {
			if got := mapped[table][column]; got != field {
				t.Errorf("%s.%s -> %q, want %q", table, column, got, field)
			}
		}
		if len(mapped[table]) != len(columns) {
			t.Errorf("%s: mapped %v, want exactly %v", table, mapped[table], columns)
		}
	}
	if len(mapped["outbox"]) != 0 {
		t.Errorf("outbox: mapped %v, want nothing", mapped["outbox"])
	}
}

// The grammar port keeps a placeholder as a node with no number on it, so the
// numbers are read off the text. Taking the order of the nodes instead would
// be right for every statement written in ascending order and silently wrong
// for the one that is not.
func TestPlaceholderNumbersComeFromTheText(t *testing.T) {
	got := placeholderNumbers("INSERT INTO t (a, b, c) VALUES ($2, $1, 1)")
	if len(got) != 2 || got[0] != 2 || got[1] != 1 {
		t.Errorf("numbers = %v, want [2 1]", got)
	}

	// A RETURNING clause is not a value being written.
	got = placeholderNumbers("INSERT INTO t (a) VALUES ($1) RETURNING id")
	if len(got) != 1 || got[0] != 1 {
		t.Errorf("numbers = %v, want [1]", got)
	}
}

// A statement is routinely assembled from a shared column list rather than
// written whole.
func TestStringValueFoldsConstantsAndConcatenation(t *testing.T) {
	constants := map[string]string{"columns": "id, name"}

	got, ok := stringValue(expr(t, "`INSERT INTO t (`+columns+`) VALUES ($1, $2)`"), constants)
	if !ok || !strings.Contains(got, "id, name") {
		t.Errorf("folded = %q ok=%v", got, ok)
	}

	// Anything that cannot be folded is left alone rather than read half
	// resolved.
	if _, ok := stringValue(expr(t, "prefix + buildRest()"), constants); ok {
		t.Error("a call is not a constant")
	}
}

// The whole point of the field: no rule over column names produces
// password_hash -> Password, and the statement that writes the row does.
func TestMapsAgainstTheRealService(t *testing.T) {
	b := builderFor(t)
	mapped := readMaps("../../examples/auth", "internal/user/infrastructure/repository", "user", b)

	users := mapped["users"]
	if users["password_hash"] != "User.Password" {
		t.Errorf("password_hash -> %q", users["password_hash"])
	}
	if users["email"] != "User.Email" {
		t.Errorf("email -> %q", users["email"])
	}
	// `version` is written as a literal 1, so nothing carries it from the
	// aggregate and the column stays unmapped rather than guessed at.
	if got, ok := users["version"]; ok {
		t.Errorf("version should be unmapped, got %q", got)
	}
}

// The session repository builds its statement from a constant column list and
// wraps one value in a conversion, so it exercises both readings at once.
func TestMapsThroughAConstantColumnList(t *testing.T) {
	b := builderFor(t)
	mapped := readMaps("../../examples/auth", "internal/session/infrastructure/repository", "session", b)

	sessions := mapped["sessions"]
	if sessions["revoked_at"] != "Session.RevokedAt" {
		t.Errorf("revoked_at -> %q", sessions["revoked_at"])
	}
	if sessions["user_id"] != "Session.UserID" {
		t.Errorf("user_id -> %q", sessions["user_id"])
	}
}
