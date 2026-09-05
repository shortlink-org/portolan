package main

// The mapping: records in a tree, a catalog fragment out.
//
// Shaped like plugins/extract-proto/extract_test.go, which is the house style
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

const goldenPath = "testdata/golden/adr.json"

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

	resp, err := extract(input("testdata/estate"), Options{})
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

func TestEveryRecordInTheTreeIsRead(t *testing.T) {
	var ids []string
	for _, adr := range fragment(t).Adrs {
		ids = append(ids, adr.ID)
	}
	if strings.Join(ids, " ") != "acme.0001 payments.0002 acme.0003 org.0004" {
		t.Errorf("ids = %v", ids)
	}
}

// A README in a directory of records is its index, not a decision. Reading it
// as one would put a table of contents on the site as a record with no status.
func TestAnIndexIsNotARecord(t *testing.T) {
	for _, adr := range fragment(t).Adrs {
		if strings.HasSuffix(adr.Source, "README.md") {
			t.Errorf("%q was read as a record", adr.Source)
		}
	}
}

// The fragment is one source among several, so it carries the empty lists of
// everything it says nothing about rather than leaving the merge to guess.
func TestTheFragmentSaysNothingItDidNotRead(t *testing.T) {
	cat := fragment(t)
	if len(cat.Contexts) != 0 || len(cat.Flows) != 0 || len(cat.Defs) != 0 {
		t.Errorf("the fragment claims more than its records: %+v", cat)
	}
	if cat.Commit != "abc1234" || cat.GeneratedAt != "2024-01-01T00:00:00Z" {
		t.Errorf("stamp = %q %q", cat.Commit, cat.GeneratedAt)
	}
}

func TestTheFileIsNamedByTheOptions(t *testing.T) {
	resp, err := extract(input("testdata/estate"), Options{Out: "decisions.json"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Files[0].Name != "decisions.json" {
		t.Errorf("name = %q", resp.Files[0].Name)
	}
	if response(t).Files[0].Name != "adr.json" {
		t.Errorf("the default is not adr.json")
	}
}

// A root with no records is worth saying out loud. A step pointed at the wrong
// directory answers with an empty fragment either way, and the warning is the
// only thing that tells the two apart.
func TestARootWithNoRecordsWarns(t *testing.T) {
	resp, err := extract(input("testdata"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !warned(resp, "no decision records matched") {
		t.Errorf("diagnostics = %+v", resp.Warnings())
	}
}

// Every rule src/catalog.ts fails the whole app on is checked here instead,
// where the file that broke it can be named. A fragment written half-valid is
// a blank site later, with the reason a long way from its cause.
func TestABrokenTreeIsRefusedWholeRatherThanWrittenHalf(t *testing.T) {
	resp, err := extract(input("testdata/broken"), Options{})
	if err == nil {
		t.Fatal("the broken tree produced a fragment")
	}
	if len(resp.Files) != 0 {
		t.Errorf("files were named anyway: %+v", resp.Files)
	}

	for _, want := range []string{
		"acme.0007 is already declared in",
		"acme.0001 is superseded by acme.0002, which does not say it supersedes it",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("no %q in:\n%s", want, err)
		}
	}
}

// The fragment is committed and compared by gen:check. A map iterated in Go's
// order would rewrite the file every run and turn every build into a diff.
func TestOutputIsByteIdentical(t *testing.T) {
	first, err := extract(input("testdata/estate"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		again, err := extract(input("testdata/estate"), Options{})
		if err != nil {
			t.Fatal(err)
		}
		if again.Files[0].Contents != first.Files[0].Contents {
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
		t.Fatalf("reading the golden fragment: %v (run `go test ./plugins/extract-adr -update`)", err)
	}
	if string(want) != got {
		t.Errorf("the fragment differs from the golden file\n%s", firstDifference(string(want), got))
	}
}

func warned(resp plugin.Response, substring string) bool {
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
