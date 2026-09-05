package main

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

var update = flag.Bool("update", false, "rewrite the golden files instead of comparing against them")

// TestGolden renders a small catalog that exercises every shape the schema has
// - a shared type used twice, an event with two versions, a foreign key, a
// view with lineage, and a flow with a loop around an alt around a parallel -
// and compares the whole output tree against what is committed.
//
// The fixture is small on purpose. A golden test over the real catalog would
// be 200 KB of diff on any change and nobody would read it.
func TestGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/catalog.json")
	if err != nil {
		t.Fatal(err)
	}

	var cat catalog.Catalog
	if err := json.Unmarshal(raw, &cat); err != nil {
		t.Fatalf("the fixture does not fit the mirror: %v", err)
	}

	resp := render(plugin.Request{
		PortolanVersion: plugin.Version,
		Catalog:         cat,
	}, Options{Title: "Golden estate"})

	if *update {
		if err := os.RemoveAll("testdata/golden"); err != nil {
			t.Fatal(err)
		}
		for _, file := range resp.Files {
			path := filepath.Join("testdata/golden", filepath.FromSlash(file.Name))
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(file.Contents), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		t.Log("golden files rewritten")

		return
	}

	rendered := map[string]string{}
	for _, file := range resp.Files {
		rendered[file.Name] = file.Contents
	}

	for name, want := range goldenFiles(t) {
		got, ok := rendered[name]
		if !ok {
			t.Errorf("%s: in the golden files, no longer rendered", name)

			continue
		}
		if got != want {
			t.Errorf("%s: differs from the golden file\n%s", name, firstDifference(want, got))
		}
		delete(rendered, name)
	}

	for _, name := range sortedNames(rendered) {
		t.Errorf("%s: rendered, but not in the golden files", name)
	}
}

// TestGoldenDiagnostics pins what the plugin says it could not do. A render
// that quietly stops noticing a dangling reference is the failure this catches.
func TestGoldenDiagnostics(t *testing.T) {
	raw, err := os.ReadFile("testdata/catalog.json")
	if err != nil {
		t.Fatal(err)
	}

	var cat catalog.Catalog
	if err := json.Unmarshal(raw, &cat); err != nil {
		t.Fatal(err)
	}

	resp := render(plugin.Request{Catalog: cat}, Options{})

	want := []string{
		`billing.invoices: billing.invoices calls "psp.v1.Charges/Create", which nothing in this catalog resolves`,
		`flow.raise-invoice: flow.raise-invoice step "s3" is unresolved: psp.v1.Charges/Create`,
	}

	got := make([]string, 0, len(resp.Warnings()))
	for _, d := range resp.Warnings() {
		got = append(got, d.Ref+": "+d.Message)
	}
	sort.Strings(got)
	sort.Strings(want)

	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("diagnostics changed:\n got: %s\nwant: %s", strings.Join(got, "\n      "), strings.Join(want, "\n      "))
	}
}

func goldenFiles(t *testing.T) map[string]string {
	t.Helper()

	files := map[string]string{}
	err := filepath.WalkDir("testdata/golden", func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}

		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}

		name, err := filepath.Rel("testdata/golden", path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(name)] = string(contents)

		return nil
	})
	if err != nil {
		t.Fatalf("reading golden files: %v (run `go test ./plugins/gen-markdown -update`)", err)
	}
	if len(files) == 0 {
		t.Fatal("no golden files; run `go test ./plugins/gen-markdown -update`")
	}

	return files
}

// firstDifference reports the first line that differs, with a little context.
// A whole-file diff of a generated page is unreadable in test output.
func firstDifference(want, got string) string {
	wantLines := strings.Split(want, "\n")
	gotLines := strings.Split(got, "\n")

	for i := 0; i < len(wantLines) || i < len(gotLines); i++ {
		w, g := at(wantLines, i), at(gotLines, i)
		if w == g {
			continue
		}

		return "line " + itoa(i+1) + ":\n  want: " + w + "\n   got: " + g
	}

	return "(files differ only in trailing content)"
}

func at(lines []string, i int) string {
	if i < len(lines) {
		return lines[i]
	}

	return "(end of file)"
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

func sortedNames(files map[string]string) []string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)

	return names
}
