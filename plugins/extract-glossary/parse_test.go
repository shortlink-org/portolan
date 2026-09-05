package main

import (
	"os"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

const sample = `# Glossary — auth

One meaning per word inside this context. The code, the events and the API
spell these the same way.

**Email address.** The address a user logs in with, normalised on creation.

**Session.** Proof that a user logged in, and how long that proof is good for,
and whether it has been taken away.

**Version.** The number the store compares before writing an aggregate. Zero
means never stored.
`

const file = "examples/auth/GLOSSARY.md"

func parsed(t *testing.T, src string) []catalog.Term {
	t.Helper()

	terms, _, errs := parseGlossary(file, "auth", src)
	if len(errs) > 0 {
		t.Fatalf("errors: %s", strings.Join(errs, "\n"))
	}

	return terms
}

func refused(t *testing.T, src string) string {
	t.Helper()

	_, _, errs := parseGlossary(file, "auth", src)
	if len(errs) == 0 {
		t.Fatal("parsed without complaint")
	}

	return strings.Join(errs, "\n")
}

func warned(t *testing.T, src string) string {
	t.Helper()

	_, warns, errs := parseGlossary(file, "auth", src)
	if len(errs) > 0 {
		t.Fatalf("errors: %s", strings.Join(errs, "\n"))
	}

	return strings.Join(warns, "\n")
}

func term(t *testing.T, terms []catalog.Term, name string) catalog.Term {
	t.Helper()

	for _, candidate := range terms {
		if candidate.Name == name {
			return candidate
		}
	}
	t.Fatalf("no term called %q", name)

	return catalog.Term{}
}

func TestTheDefinitionIsTheParagraph(t *testing.T) {
	session := term(t, parsed(t, sample), "Session")

	want := "Proof that a user logged in, and how long that proof is good for, and whether it has been taken away."
	if session.Definition != want {
		t.Errorf("definition is %q, want %q", session.Definition, want)
	}
}

// The hard wrap in the file is a soft break in markdown, and a definition that
// carried it would be a definition nothing could put on a card.
func TestParagraphIsOneLine(t *testing.T) {
	for _, term := range parsed(t, sample) {
		if strings.ContainsAny(term.Definition, "\n") {
			t.Errorf("%s carries a line break", term.Name)
		}
	}
}

func TestTwoWordTerm(t *testing.T) {
	address := term(t, parsed(t, sample), "Email address")

	if address.Slug != "email-address" {
		t.Errorf("slug is %q", address.Slug)
	}
	if address.ID != "auth.email-address" {
		t.Errorf("id is %q", address.ID)
	}
	if address.Context != "auth" {
		t.Errorf("context is %q", address.Context)
	}
}

func TestSourceIsTheLineTheEntryStartsOn(t *testing.T) {
	if got := term(t, parsed(t, sample), "Session").Source; got != file+":8" {
		t.Errorf("source is %q, want %s:8", got, file)
	}
}

func TestPreambleIsNotATerm(t *testing.T) {
	if terms := parsed(t, sample); len(terms) != 3 {
		names := []string{}
		for _, term := range terms {
			names = append(names, term.Name)
		}
		t.Errorf("read %d terms: %s", len(terms), strings.Join(names, ", "))
	}
}

func TestTableIsRefused(t *testing.T) {
	src := "# Glossary — auth\n\n| Term | Meaning |\n| --- | --- |\n| Session | Proof. |\n"

	if got := refused(t, src); !strings.Contains(got, "prose") {
		t.Errorf("refusal is %q", got)
	}
}

func TestHeadingPerTermIsRefused(t *testing.T) {
	src := "# Glossary — auth\n\n## Session\n\nProof that a user logged in.\n"

	if got := refused(t, src); !strings.Contains(got, "a term is a paragraph") {
		t.Errorf("refusal is %q", got)
	}
}

func TestListIsRefused(t *testing.T) {
	src := "# Glossary — auth\n\n- **Session.** Proof that a user logged in.\n"

	if got := refused(t, src); !strings.Contains(got, "a list") {
		t.Errorf("refusal is %q", got)
	}
}

func TestAFileThatIsNotAGlossaryIsRefused(t *testing.T) {
	src := "# Sessions\n\n**Session.** Proof that a user logged in.\n"

	if got := refused(t, src); !strings.Contains(got, "opens with `# Glossary") {
		t.Errorf("refusal is %q", got)
	}
}

// A word with two meanings inside one context is the failure the glossary is
// written to prevent, so it is the one duplication that cannot be a warning.
func TestTheSameWordTwiceIsRefused(t *testing.T) {
	src := sample + "\n**Session.** Something else entirely.\n"

	if got := refused(t, src); !strings.Contains(got, "already defined on line 8") {
		t.Errorf("refusal is %q", got)
	}
}

func TestOutOfOrderIsAWarning(t *testing.T) {
	src := "# Glossary — auth\n\n**Lockout.** An account refusing passwords.\n\n**Locked.** The state of a lockout while it refuses.\n"

	if got := warned(t, src); !strings.Contains(got, "alphabetical") {
		t.Errorf("warnings are %q", got)
	}
}

func TestAnEntryThatNamesNothing(t *testing.T) {
	src := "# Glossary — auth\n\n**Session** proof that a user logged in.\n"

	if got := refused(t, src); !strings.Contains(got, "the full stop inside it") {
		t.Errorf("refusal is %q", got)
	}
}

// The estate's own glossaries parse, and are held to the format they document.
func TestTheEstatesOwnGlossaries(t *testing.T) {
	for _, tt := range []struct{ path, context string }{
		{"../../examples/auth/GLOSSARY.md", "auth"},
		{"../../examples/shop/oms/GLOSSARY.md", "shop"},
	} {
		t.Run(tt.path, func(t *testing.T) {
			src, err := os.ReadFile(tt.path)
			if err != nil {
				t.Fatal(err)
			}
			terms, warns, errs := parseGlossary(tt.path, tt.context, string(src))
			if len(errs) > 0 {
				t.Fatalf("errors: %s", strings.Join(errs, "\n"))
			}
			if len(warns) > 0 {
				t.Errorf("warnings: %s", strings.Join(warns, "\n"))
			}
			if len(terms) == 0 {
				t.Error("no terms read")
			}
		})
	}
}
