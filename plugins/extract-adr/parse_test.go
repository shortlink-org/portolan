package main

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

const sample = `# auth.0003 — Session expiry publishes no event

- **Status:** accepted
- **Date:** 2026-08-22
- **Scope:** auth.auth
- **Supersedes:** auth.0001, auth.0002
- **Relates:** auth.auth.session.SessionEnded, shop.cart, checkout
- **Note:** how a revocation is kept out of the cache was decided again in
  auth.0010; the drop turned out not to be enough.

## Context and Problem Statement

A session stops being usable at ` + "`ExpiresAt`" + `.

### An aside

Kept as written.

## Decision Outcome

No event.
`

func parsed(t *testing.T, src string) catalog.Adr {
	t.Helper()

	adr, errs := parseAdr("examples/auth/docs/adr/0003-expiry-publishes-nothing.md", src)
	if len(errs) > 0 {
		t.Fatalf("errors: %s", strings.Join(errs, "\n"))
	}

	return adr
}

func refused(t *testing.T, src string) string {
	t.Helper()

	_, errs := parseAdr("examples/auth/docs/adr/0003-expiry-publishes-nothing.md", src)
	if len(errs) == 0 {
		t.Fatal("parsed without complaint")
	}

	return strings.Join(errs, "\n")
}

// Replaces one meta bullet with another, so a test says what it is about and
// nothing else.
func with(bullet, replacement string) string {
	return strings.Replace(sample, bullet, replacement, 1)
}

func TestTheTitleCarriesTheIDAndTheTitle(t *testing.T) {
	adr := parsed(t, sample)
	if adr.ID != "auth.0003" || adr.Number != 3 || adr.Title != "Session expiry publishes no event" {
		t.Errorf("id %q, number %d, title %q", adr.ID, adr.Number, adr.Title)
	}
}

// The slug is the id with its dots opened out, then the file's own kebab: the
// id says which record this is and the file's name says what it was about,
// which is the slug the catalog carried when these were written by hand.
func TestTheSlugIsTheIDAndTheFileName(t *testing.T) {
	adr := parsed(t, sample)
	if adr.Slug != "auth-0003-expiry-publishes-nothing" {
		t.Errorf("slug = %q", adr.Slug)
	}
	if adr.Source != "examples/auth/docs/adr/0003-expiry-publishes-nothing.md" {
		t.Errorf("source = %q", adr.Source)
	}
}

func TestAFileNumberedAwayFromItsRecordIsRefused(t *testing.T) {
	_, errs := parseAdr("docs/adr/0009-expiry-publishes-nothing.md", sample)
	if len(errs) != 1 || !strings.Contains(errs[0], "numbered 0009") {
		t.Errorf("errors: %v", errs)
	}
}

func TestTheMetaBulletsAreRead(t *testing.T) {
	adr := parsed(t, sample)
	if adr.Status != catalog.AdrAccepted || adr.Date != "2026-08-22" {
		t.Errorf("status %q, date %q", adr.Status, adr.Date)
	}
	if adr.Scope != (catalog.AdrScope{Kind: "service", Service: "auth.auth"}) {
		t.Errorf("scope = %+v", adr.Scope)
	}
	if strings.Join(adr.Supersedes, ",") != "auth.0001,auth.0002" {
		t.Errorf("supersedes = %v", adr.Supersedes)
	}
}

// A bullet wrapped onto the next line is one bullet: the break is the author's
// line width and carries no meaning, so it closes up into a space.
func TestAWrappedBulletIsOneValue(t *testing.T) {
	adr := parsed(t, sample)
	want := "how a revocation is kept out of the cache was decided again in auth.0010; the drop turned out not to be enough."
	if adr.Note != want {
		t.Errorf("note = %q", adr.Note)
	}
}

// The scope's shape says which of the three kinds it is, and nothing else can:
// an extractor sees one service's tree and has no catalog to look a name up in.
func TestScopeKindComesFromTheNumberOfSegments(t *testing.T) {
	for _, c := range []struct {
		written string
		want    catalog.AdrScope
	}{
		{"org", catalog.AdrScope{Kind: "org"}},
		{"", catalog.AdrScope{Kind: "org"}},
		{"payments", catalog.AdrScope{Kind: "context", Context: "payments"}},
		{"shop.cart", catalog.AdrScope{Kind: "service", Service: "shop.cart"}},
	} {
		adr := parsed(t, with("- **Scope:** auth.auth", "- **Scope:** "+c.written))
		if adr.Scope != c.want {
			t.Errorf("%q read as %+v, want %+v", c.written, adr.Scope, c.want)
		}
	}
}

// One list in the file, three in the catalog. An author should not have to
// remember which of the three a name belongs in, so the name's shape says.
func TestRelatesIsSortedByShape(t *testing.T) {
	adr := parsed(t, sample)
	if strings.Join(adr.Relates.Events, ",") != "auth.auth.session.SessionEnded" {
		t.Errorf("events = %v", adr.Relates.Events)
	}
	if strings.Join(adr.Relates.Services, ",") != "shop.cart" {
		t.Errorf("services = %v", adr.Relates.Services)
	}
	if strings.Join(adr.Relates.Flows, ",") != "checkout" {
		t.Errorf("flows = %v", adr.Relates.Flows)
	}
}

func TestARelationOfNoRecognisableShapeIsRefused(t *testing.T) {
	errs := refused(t, with("- **Relates:** auth.auth.session.SessionEnded, shop.cart, checkout", "- **Relates:** auth.auth.session"))
	if !strings.Contains(errs, "not the shape of an event, a service or a flow") {
		t.Errorf("errors: %s", errs)
	}
}

// The body is frozen history. It starts at the first `##` and is carried into
// the catalog exactly as written, headings and all, because nothing on an ADR
// page is ever regenerated from the model as it stands now.
func TestTheBodyStartsAtTheFirstSectionAndIsUnedited(t *testing.T) {
	adr := parsed(t, sample)
	if !strings.HasPrefix(adr.Body, "## Context and Problem Statement\n") {
		t.Errorf("body starts %q", adr.Body[:40])
	}
	if !strings.Contains(adr.Body, "### An aside") || !strings.Contains(adr.Body, "`ExpiresAt`") {
		t.Errorf("body = %q", adr.Body)
	}
	if !strings.HasSuffix(adr.Body, "No event.\n") {
		t.Errorf("body ends %q", adr.Body[len(adr.Body)-20:])
	}
}

func TestWhatARecordCannotBeReadWithout(t *testing.T) {
	for key, bullet := range map[string]string{
		"Status": "- **Status:** accepted",
		"Date":   "- **Date:** 2026-08-22",
		"Scope":  "- **Scope:** auth.auth",
	} {
		errs := refused(t, strings.Replace(sample, bullet+"\n", "", 1))
		if !strings.Contains(errs, "says no \""+key+"\"") {
			t.Errorf("dropping %s gave: %s", key, errs)
		}
	}
}

func TestAStatusOrDateThatIsNeitherIsRefused(t *testing.T) {
	if errs := refused(t, with("- **Status:** accepted", "- **Status:** agreed")); !strings.Contains(errs, "is not a status") {
		t.Errorf("errors: %s", errs)
	}
	if errs := refused(t, with("- **Date:** 2026-08-22", "- **Date:** last August")); !strings.Contains(errs, "is not a date") {
		t.Errorf("errors: %s", errs)
	}
}

// Supersession is a two-way fact, and half of it recorded is a bug. Both
// halves that live in one file are held against each other here; the halves in
// two files are held against each other by extract.
func TestHalfARecordedSupersessionIsRefused(t *testing.T) {
	errs := refused(t, with("- **Status:** accepted", "- **Status:** superseded"))
	if !strings.Contains(errs, "superseded and says by what") {
		t.Errorf("errors: %s", errs)
	}

	errs = refused(t, with("- **Supersedes:** auth.0001, auth.0002", "- **Superseded by:** auth.0007"))
	if !strings.Contains(errs, `its status is "accepted"`) {
		t.Errorf("errors: %s", errs)
	}
}

func TestABulletTheFormatDoesNotHaveIsRefused(t *testing.T) {
	errs := refused(t, with("- **Note:**", "- **Owner:**"))
	if !strings.Contains(errs, "is not one of the bullets a record carries") {
		t.Errorf("errors: %s", errs)
	}
}

// The head is bullets and nothing else. A paragraph that drifted above the
// first `##` would be read by a person and dropped by the extractor, and the
// record on the page would quietly be missing its opening.
func TestProseBetweenTheTitleAndTheRecordIsRefused(t *testing.T) {
	errs := refused(t, with("## Context and Problem Statement", "A stray paragraph.\n\n## Context and Problem Statement"))
	if !strings.Contains(errs, "only meta bullets belong") {
		t.Errorf("errors: %s", errs)
	}
}

func TestARecordWithNoBodyIsRefused(t *testing.T) {
	errs := refused(t, "# auth.0003 — A title\n\n- **Status:** accepted\n- **Date:** 2026-08-22\n- **Scope:** auth.auth\n")
	if !strings.Contains(errs, "no body") {
		t.Errorf("errors: %s", errs)
	}
}

func TestATitleThatIsNotOneIsRefused(t *testing.T) {
	if errs := refused(t, strings.Replace(sample, "auth.0003 — Session", "auth.0003 - Session", 1)); !strings.Contains(errs, "em dash") {
		t.Errorf("errors: %s", errs)
	}
	if errs := refused(t, strings.Replace(sample, "auth.0003 —", "auth.3 —", 1)); !strings.Contains(errs, "four padded digits") {
		t.Errorf("errors: %s", errs)
	}
}

// Every mistake in a header, not the first one: a file with two typos in it
// should be fixed once.
func TestEveryMistakeIsReported(t *testing.T) {
	src := with("- **Status:** accepted", "- **Status:** agreed")
	src = strings.Replace(src, "- **Date:** 2026-08-22", "- **Date:** last August", 1)
	if _, errs := parseAdr("docs/adr/0003-expiry-publishes-nothing.md", src); len(errs) != 2 {
		t.Errorf("errors: %v", errs)
	}
}
