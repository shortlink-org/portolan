package extractadr

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
	"path/filepath"
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

	resp, err := extract(input("testdata/estate"), Options{History: "none"})
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
	resp, err := extract(input("testdata/estate"), Options{History: "none", Out: "decisions.json"})
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
	resp, err := extract(input("testdata"), Options{History: "none"})
	if err != nil {
		t.Fatal(err)
	}
	if !warned(resp, "no decision records matched") {
		t.Errorf("diagnostics = %+v", resp.Warnings())
	}
}

// A supersession with one half recorded is refused whole: src/catalog.ts
// fails the app on it, and either record alone would say something untrue.
func TestAHalfRecordedSupersessionIsRefusedWhole(t *testing.T) {
	resp, err := extract(input("testdata/broken"), Options{History: "none"})
	if err == nil {
		t.Fatal("the broken tree produced a fragment")
	}
	if len(resp.Files) != 0 {
		t.Errorf("files were named anyway: %+v", resp.Files)
	}
	if want := "acme.0001 is superseded by acme.0002, which does not say it supersedes it"; !strings.Contains(err.Error(), want) {
		t.Errorf("no %q in:\n%s", want, err)
	}
}

// A tree kept with adr-tools, with the mistakes such a tree collects: two
// records numbered the same by two branches, and a file of notes among them.
// Each is left out with a warning that names it, and the rest is read.
func TestATreeOfAdrToolsRecordsIsReadAndItsMistakesAreLeftOut(t *testing.T) {
	resp, err := extract(input("testdata/lenient"), Options{Scope: "avia.aviasupp", Files: []string{"docs/adr/*.md"}, History: "none"})
	if err != nil {
		t.Fatal(err)
	}
	var cat catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &cat); err != nil {
		t.Fatal(err)
	}

	var ids []string
	for _, adr := range cat.Adrs {
		ids = append(ids, adr.ID)
	}
	if strings.Join(ids, " ") != "aviasupp.0001 aviasupp.0003 aviasupp.0004 aviasupp.0005 acme.0007" {
		t.Errorf("ids = %v", ids)
	}

	for _, want := range []string{
		"0004-use-river.md: left out of the fragment: aviasupp.0004 is already declared in",
		"0006-a-note-that-is-not-a-record.md: left out of the fragment: ",
		"0007-declared-once.md: left out of the fragment: acme.0007 is already declared in",
	} {
		if !warnedAt(resp, want) {
			t.Errorf("no warning %q among %+v", want, resp.Warnings())
		}
	}

	by := map[string]catalog.Adr{}
	for _, adr := range cat.Adrs {
		by[adr.ID] = adr
	}
	if dto := by["aviasupp.0003"]; dto.Status != catalog.AdrSuperseded || dto.SupersededBy != "aviasupp.0005" {
		t.Errorf("aviasupp.0003 = %+v", dto)
	}
	if schemas := by["aviasupp.0005"]; strings.Join(schemas.Supersedes, " ") != "aviasupp.0003" {
		t.Errorf("aviasupp.0005 supersedes %v", schemas.Supersedes)
	}
	if action := by["aviasupp.0004"]; action.Status != catalog.AdrProposed || action.Title != "Call action" {
		t.Errorf("aviasupp.0004 = %+v", action)
	}
}

func warnedAt(resp plugin.Response, substring string) bool {
	for _, d := range resp.Warnings() {
		if strings.Contains(d.Ref+": "+d.Message, substring) {
			return true
		}
	}

	return false
}

// The fragment is committed and compared by gen:check. A map iterated in Go's
// order would rewrite the file every run and turn every build into a diff.
func TestOutputIsByteIdentical(t *testing.T) {
	first, err := extract(input("testdata/estate"), Options{History: "none"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		again, err := extract(input("testdata/estate"), Options{History: "none"})
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

// Who wrote a record down and when comes from the file's own commits, which
// the host read and put in the request (portolan.0007): the first commit is
// when it was created, the last when it was revised, and a file committed once
// has no revision. A request with no history - the tree is not a checkout -
// is said so, once.
func TestWhoCommittedARecordComesFromTheRequest(t *testing.T) {
	root := t.TempDir()
	write := func(name, contents string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Join(root, "docs", "adr"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "docs", "adr", name), []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	record := func(title, body string) string {
		return "# " + title + "\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Context\n\n" + body + "\n"
	}
	write("0001-first.md", record("1. First", "As written."))
	write("0002-second.md", record("2. Second", "Reworded."))

	ada := plugin.Commit{Commit: strings.Repeat("a", 40), Author: "Ada Lovelace", Date: "2026-01-01T09:00:00Z"}
	grace := plugin.Commit{Commit: strings.Repeat("b", 40), Author: "Grace Hopper", Date: "2026-01-03T17:30:00Z"}
	// Keyed the way the extractor names a file: the root joined to the match.
	in := input(root)
	in.History = map[string]plugin.FileHistory{
		filepath.ToSlash(filepath.Join(root, "docs/adr/0001-first.md")):  {Created: ada},
		filepath.ToSlash(filepath.Join(root, "docs/adr/0002-second.md")): {Created: ada, Revised: &grace},
	}

	resp, err := extract(in, Options{Scope: "org"})
	if err != nil {
		t.Fatal(err)
	}
	var cat catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &cat); err != nil {
		t.Fatal(err)
	}
	if len(cat.Adrs) != 2 {
		t.Fatalf("adrs = %+v", cat.Adrs)
	}

	first, second := cat.Adrs[0], cat.Adrs[1]
	if first.Created == nil || *first.Created != (catalog.AdrCommit{Commit: ada.Commit, Author: ada.Author, Date: ada.Date}) {
		t.Errorf("first created = %+v", first.Created)
	}
	if first.Revised != nil {
		t.Errorf("a file committed once was revised: %+v", first.Revised)
	}
	if second.Created == nil || second.Created.Author != "Ada Lovelace" {
		t.Errorf("second created = %+v", second.Created)
	}
	if second.Revised == nil || second.Revised.Author != "Grace Hopper" || second.Revised.Date != "2026-01-03T17:30:00Z" || second.Revised.Commit != grace.Commit {
		t.Errorf("second revised = %+v", second.Revised)
	}

	// A revision that is the creating commit is no revision.
	in.History[filepath.ToSlash(filepath.Join(root, "docs/adr/0001-first.md"))] = plugin.FileHistory{Created: ada, Revised: &ada}
	resp, err = extract(in, Options{Scope: "org"})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &cat); err != nil {
		t.Fatal(err)
	}
	if cat.Adrs[0].Revised != nil {
		t.Errorf("revised by its own creating commit: %+v", cat.Adrs[0].Revised)
	}

	// Told not to look, the extractor does not.
	resp, err = extract(in, Options{Scope: "org", History: "none"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(resp.Files[0].Contents, "\"created\"") {
		t.Error("history \"none\" still read the history")
	}

	// No history in the request: the tree is not a checkout. Said once, and
	// the records are read all the same.
	resp, err = extract(input(root), Options{Scope: "org"})
	if err != nil {
		t.Fatal(err)
	}
	if !warned(resp, "not inside a git checkout") {
		t.Errorf("warnings = %+v", resp.Warnings())
	}
	if strings.Contains(resp.Files[0].Contents, "\"created\"") {
		t.Error("a request without history still produced one")
	}
}

func TestARecordWithoutADateUsesTheDayItWasFirstCommitted(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "docs", "adr")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "01-package-layout.md")
	if err := os.WriteFile(file, []byte("# ADR-1. Package layout\n\n## Status: approved\n\n## Decision\n\nKeep packages flat.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	in := input(root)
	in.History = map[string]plugin.FileHistory{
		filepath.ToSlash(file): {Created: plugin.Commit{
			Commit: strings.Repeat("c", 40),
			Author: "Ada Lovelace",
			Date:   "2025-02-03T14:15:16Z",
		}},
	}
	resp, err := extract(in, Options{Scope: "platform.api"})
	if err != nil {
		t.Fatal(err)
	}
	var cat catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &cat); err != nil {
		t.Fatal(err)
	}
	if len(cat.Adrs) != 1 {
		t.Fatalf("adrs = %+v; warnings = %+v", cat.Adrs, resp.Warnings())
	}
	if adr := cat.Adrs[0]; adr.Date != "2025-02-03" || adr.Status != catalog.AdrAccepted || adr.ID != "api.0001" {
		t.Errorf("adr = %+v", adr)
	}
}

// The descriptor is how the host learns to send the history at all.
func TestTheDescriptorAsksForHistory(t *testing.T) {
	if needs := descriptor().Needs; len(needs) != 1 || needs[0] != plugin.NeedHistory {
		t.Errorf("needs = %v", needs)
	}
}
