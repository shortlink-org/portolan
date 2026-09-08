package extractgo

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

const enumSrc = `package event

// Reason says why a session stopped being usable. It is a closed set.
type Reason string

const (
	// ReasonLogout - the user asked.
	ReasonLogout Reason = "logout"
	// ReasonRevoked - somebody else ended it.
	//
	// Deprecated: support ends sessions through ReasonRiskBlocked now.
	ReasonRevoked Reason = "revoked"
	reasonHidden  Reason = "hidden"
	Unrelated            = "loose"
)

// Level is how loud the end was.
type Level int

const (
	Quiet Level = iota // barely
	Loud
)

// Alias names a string and nothing is declared of it.
type Alias string

type Point struct{ X int }
`

func TestEnumsAreTheConstantsOfANamedBasicType(t *testing.T) {
	p, err := parseSource("session_ended.go", enumSrc)
	if err != nil {
		t.Fatal(err)
	}
	enums := enumsIn(p, "auth.auth.session", "")
	if len(enums) != 2 {
		t.Fatalf("enums = %+v", enums)
	}

	reason := enums[0]
	if reason.ID != "auth.auth.session.reason" || reason.Doc != "Reason says why a session stopped being usable. It is a closed set." {
		t.Errorf("reason = %+v", reason)
	}
	// The literal, not the constant's name: it is what the wire carries.
	if got := valueNames(reason.Values); got != "logout,revoked" {
		t.Errorf("values = %s", got)
	}
	if !reason.Values[1].Deprecated || reason.Values[0].Deprecated {
		t.Errorf("deprecation not read off the doc: %+v", reason.Values)
	}
	if reason.Values[0].Doc != "ReasonLogout - the user asked." {
		t.Errorf("doc = %q", reason.Values[0].Doc)
	}

	// An iota has no literal to show, so the constant's name stands; the
	// trailing comment is its doc.
	level := enums[1]
	if got := valueNames(level.Values); got != "Quiet,Loud" {
		t.Errorf("level values = %s", got)
	}
	if level.Values[0].Doc != "barely" {
		t.Errorf("trailing comment not read: %q", level.Values[0].Doc)
	}
}

func valueNames(values []catalog.EnumValue) string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		out = append(out, v.Name)
	}
	return strings.Join(out, ",")
}
