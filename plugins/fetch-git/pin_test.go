package main

import (
	"encoding/json"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

// A pin is matched against a service's `repo`, which is however go.mod spells
// it. Whoever wrote the manifest may have spelled the same repository four
// other ways, and all five have to arrive at one string or the link is not
// built.
func TestWebRepoIsHowGoModSpellsIt(t *testing.T) {
	const want = "github.com/acme/shop"

	for _, spelling := range []string{
		"github.com/acme/shop",
		"github.com/acme/shop/",
		"github.com/acme/shop.git",
		"https://github.com/acme/shop",
		"https://github.com/acme/shop.git",
		"ssh://git@github.com/acme/shop.git",
		"git@github.com:acme/shop.git",
		"  github.com/acme/shop  ",
	} {
		if got := webRepo(spelling); got != want {
			t.Errorf("webRepo(%q) = %q, want %q", spelling, got, want)
		}
	}
}

// The fragment has to survive the round trip through the mirror, because that
// is the only thing that reads it: a shape the catalog does not recognise is a
// file the host writes, commits and never uses.
func TestPinIsACatalogWithOneRepo(t *testing.T) {
	out, err := pin("git@github.com:acme/shop.git", "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0")
	if err != nil {
		t.Fatal(err)
	}

	var parsed catalog.Catalog
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("fragment is not a catalog: %v", err)
	}
	if len(parsed.Repos) != 1 {
		t.Fatalf("repos = %+v, want one", parsed.Repos)
	}
	if parsed.Repos[0].Repo != "github.com/acme/shop" {
		t.Errorf("repo = %q", parsed.Repos[0].Repo)
	}
	if parsed.Repos[0].Commit != "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0" {
		t.Errorf("commit = %q", parsed.Repos[0].Commit)
	}
	if out[len(out)-1] != '\n' {
		t.Error("fragment does not end in a newline, like every other generated file here")
	}
}

// Determinism, the second of the three obligations: the same fetch writes the
// same bytes, or `gen:check` reports drift on a run that changed nothing.
func TestPinIsStable(t *testing.T) {
	first, err := pin("github.com/acme/shop", "c1d2e3f")
	if err != nil {
		t.Fatal(err)
	}
	second, err := pin("github.com/acme/shop", "c1d2e3f")
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Errorf("two runs wrote different bytes:\n%s\n%s", first, second)
	}
}
