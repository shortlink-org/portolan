package main

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
	cases := map[string]string{
		"u.ID":                  "ID",
		"u.Email.String()":      "Email",
		"nullable(s.RevokedAt)": "RevokedAt",
		"pgtype.Text(u.Email)":  "Email",
		"time.Now()":            "",
		"combine(u.A, u.B)":     "",
		"localVariable":         "",
		`"literal"`:             "",
	}

	for src, want := range cases {
		if got := fieldOf(expr(t, src)); got != want {
			t.Errorf("fieldOf(%s) = %q, want %q", src, got, want)
		}
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
	mapped := readMaps("../../examples/auth", "internal/infrastructure/repository", "user", b)

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
	mapped := readMaps("../../examples/auth", "internal/infrastructure/repository", "session", b)

	sessions := mapped["sessions"]
	if sessions["revoked_at"] != "Session.RevokedAt" {
		t.Errorf("revoked_at -> %q", sessions["revoked_at"])
	}
	if sessions["user_id"] != "Session.UserID" {
		t.Errorf("user_id -> %q", sessions["user_id"])
	}
}
