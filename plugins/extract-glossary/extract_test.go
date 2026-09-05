package main

// The mapping: glossaries in a tree, a catalog fragment out.
//
// Shaped like plugins/extract-adr/extract_test.go, which is the house style
// for an extractor test - one behaviour per test, and a whole-fragment golden
// underneath so an unintended field change is a diff rather than an assertion
// nobody thought to write.

import (
	"encoding/json"
	"flag"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

var update = flag.Bool("update", false, "rewrite the golden fragment instead of comparing against it")

const goldenPath = "testdata/golden/glossary.json"

func input(root string) plugin.Input {
	// The stamp comes from the host, which derives it from git. A plugin that
	// read a clock would write a different file every run.
	return plugin.Input{
		Root:        root,
		Commit:      "abc1234",
		GeneratedAt: "2024-01-01T00:00:00Z",
	}
}

func response(t *testing.T) plugin.Response {
	t.Helper()

	resp, err := extract(input("testdata/estate"), Options{Context: "auth"})
	if err != nil {
		t.Fatal(err)
	}

	return resp
}

func fragment(t *testing.T) catalog.Catalog {
	t.Helper()

	var cat catalog.Catalog
	if err := json.Unmarshal([]byte(response(t).Files[0].Contents), &cat); err != nil {
		t.Fatal(err)
	}

	return cat
}

func TestEveryTermInTheTreeIsRead(t *testing.T) {
	var ids []string
	for _, term := range fragment(t).Terms {
		ids = append(ids, term.ID)
	}
	if strings.Join(ids, " ") != "auth.email-address auth.session auth.version" {
		t.Errorf("ids = %v", ids)
	}
}

// The file sits beside a service and the words in it belong to a context, so
// the directory is the wrong answer whenever a context holds more than one
// service - which is the case this option exists for.
func TestTheContextIsAskedForRatherThanDerived(t *testing.T) {
	resp, err := extract(input("testdata/estate"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	var cat catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &cat); err != nil {
		t.Fatal(err)
	}
	if got := cat.Terms[0].ID; got != "estate.email-address" {
		t.Errorf("without the option the id is %q, want the directory's name", got)
	}
	if got := fragment(t).Terms[0].ID; got != "auth.email-address" {
		t.Errorf("with the option the id is %q", got)
	}
}

// A context that is not a slug would build ids nothing else in the estate can
// match, and the term would simply never be found again.
func TestAContextThatIsNotASlugIsRefused(t *testing.T) {
	_, err := extract(input("testdata/estate"), Options{Context: "shop.oms"})
	if err == nil {
		t.Fatal("a dotted context produced a fragment")
	}
	if !strings.Contains(err.Error(), "is not a context slug") {
		t.Errorf("refusal is %q", err)
	}
}

// The fragment is one source among several, so it carries the empty lists of
// everything it says nothing about rather than leaving the merge to guess.
func TestTheFragmentSaysNothingItDidNotRead(t *testing.T) {
	cat := fragment(t)
	if len(cat.Contexts) != 0 || len(cat.Flows) != 0 || len(cat.Defs) != 0 || len(cat.Adrs) != 0 {
		t.Errorf("the fragment claims more than its terms: %+v", cat)
	}
	if cat.Commit != "abc1234" || cat.GeneratedAt != "2024-01-01T00:00:00Z" {
		t.Errorf("stamp = %q %q", cat.Commit, cat.GeneratedAt)
	}
}

func TestTheFileIsNamedByTheOptions(t *testing.T) {
	resp, err := extract(input("testdata/estate"), Options{Context: "auth", Out: "words.json"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Files[0].Name != "words.json" {
		t.Errorf("name = %q", resp.Files[0].Name)
	}
	if response(t).Files[0].Name != "glossary.json" {
		t.Errorf("the default is not glossary.json")
	}
}

// A root with no glossary is worth saying out loud. A step pointed at the
// wrong directory answers with an empty fragment either way, and the warning
// is the only thing that tells the two apart.
func TestARootWithNoGlossaryWarns(t *testing.T) {
	resp, err := extract(input("testdata"), Options{Context: "auth"})
	if err != nil {
		t.Fatal(err)
	}
	if !warnedAbout(resp, "no glossary matched") {
		t.Errorf("diagnostics = %+v", resp.Warnings())
	}
}

// Every rule the format has is checked here, where the file that broke it can
// be named. A fragment written half-valid is a word with no meaning on a page
// later, with the reason a long way from its cause.
func TestABrokenGlossaryIsRefusedWholeRatherThanWrittenHalf(t *testing.T) {
	resp, err := extract(input("testdata/broken"), Options{Context: "shop"})
	if err == nil {
		t.Fatal("the broken tree produced a fragment")
	}
	if len(resp.Files) != 0 {
		t.Errorf("files were named anyway: %+v", resp.Files)
	}
	if !strings.Contains(err.Error(), "prose") {
		t.Errorf("refusal is %q", err)
	}
}

// One context, one vocabulary: two files defining the same word is the failure
// the glossary is written to prevent, and it is only visible from up here.
func TestTheSameWordInTwoFilesIsRefused(t *testing.T) {
	_, err := extract(input("testdata/twice"), Options{Context: "shop", Files: []string{"*.GLOSSARY.md"}})
	if err == nil {
		t.Fatal("two definitions of one word produced a fragment")
	}
	if !strings.Contains(err.Error(), "Order is already defined in") {
		t.Errorf("refusal is %q", err)
	}
}

// The fragment is committed and compared by gen:check. A map iterated in Go's
// order would rewrite the file every run and turn every build into a diff.
func TestOutputIsByteIdentical(t *testing.T) {
	first := response(t).Files[0].Contents
	for i := 0; i < 5; i++ {
		if again := response(t).Files[0].Contents; again != first {
			t.Fatal("two runs over the same tree produced different fragments")
		}
	}
}

// The whole fragment, so a field that changes shape shows up as a diff rather
// than slipping past every assertion above.
func TestGoldenFragment(t *testing.T) {
	got := response(t).Files[0].Contents

	if *update {
		if err := os.WriteFile(goldenPath, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Log("golden fragment rewritten")

		return
	}

	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("reading the golden fragment: %v (run `go test ./plugins/extract-glossary -update`)", err)
	}
	if string(want) != got {
		t.Errorf("the fragment differs from the golden file\n%s", firstDifference(string(want), got))
	}
}

func warnedAbout(resp plugin.Response, substring string) bool {
	for _, d := range resp.Warnings() {
		if strings.Contains(d.Message, substring) {
			return true
		}
	}

	return false
}

func firstDifference(want, got string) string {
	a := strings.Split(want, "\n")
	b := strings.Split(got, "\n")
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return "line " + strconv.Itoa(i+1) + ":\n  want: " + a[i] + "\n  got:  " + b[i]
		}
	}

	return "want " + strconv.Itoa(len(a)) + " lines, got " + strconv.Itoa(len(b))
}
