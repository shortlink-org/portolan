package main

// What the glossary page promises, said once here rather than read out of the
// golden tree: the golden proves the bytes, these prove the intent.

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func rendered(t *testing.T) map[string]string {
	t.Helper()

	raw, err := os.ReadFile("testdata/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var cat catalog.Catalog
	if err := json.Unmarshal(raw, &cat); err != nil {
		t.Fatal(err)
	}

	out := map[string]string{}
	for _, file := range render(plugin.Request{Catalog: cat}, Options{Title: "Golden estate"}).Files {
		out[file.Name] = file.Contents
	}

	return out
}

func page(t *testing.T, name string) string {
	t.Helper()

	pages := rendered(t)
	body, ok := pages[name]
	if !ok {
		t.Fatalf("no page %s", name)
	}

	return body
}

// A page of its own, beside the context's README: the README says what the
// services do, the glossary says what the words in that sentence mean.
func TestGlossaryIsItsOwnPage(t *testing.T) {
	body := page(t, "billing/glossary.md")

	if !strings.HasPrefix(body, "# Glossary — Billing\n") {
		t.Errorf("the page opens with %q", strings.SplitN(body, "\n", 2)[0])
	}
	for _, want := range []string{
		"**Invoice** — What a customer is asked to pay",
		"**Dunning** — Asking again, on a schedule",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("no %q in:\n%s", want, body)
		}
	}
}

// Alphabetical, whatever order the sources merged in. A glossary is looked up,
// not read through, and catalog order is nobody's index.
func TestTermsAreAlphabetical(t *testing.T) {
	body := page(t, "billing/glossary.md")

	dunning := strings.Index(body, "**Dunning**")
	invoice := strings.Index(body, "**Invoice**")
	if dunning < 0 || invoice < 0 || dunning > invoice {
		t.Errorf("Dunning at %d, Invoice at %d", dunning, invoice)
	}
}

// The file the words were read from, named once on the page rather than once
// per term: the reader who disagrees with a definition edits that file.
func TestThePageNamesWhereTheWordsWereWritten(t *testing.T) {
	if body := page(t, "billing/glossary.md"); !strings.Contains(body, "examples/billing/GLOSSARY.md") {
		t.Errorf("the page does not say where it was read from:\n%s", body)
	}
}

func TestTheContextPageLinksItsGlossary(t *testing.T) {
	if body := page(t, "billing/README.md"); !strings.Contains(body, "[Glossary](glossary.md)") {
		t.Errorf("the context page does not link the glossary:\n%s", body)
	}
}

func TestServiceReadmeLinksUseGeneratedAdrAndGlossaryPages(t *testing.T) {
	body := page(t, "billing/invoices/README.md")

	for _, want := range []string{
		"[GLOSSARY.md](../glossary.md)",
		"[billing.0001](../../adr/billing.0001.md)",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the service README does not rewrite %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "](GLOSSARY.md)") || strings.Contains(body, "](../../docs/adr/0001.md)") {
		t.Errorf("the copied source links survived unchanged:\n%s", body)
	}
}

// Straight after the contexts, before the pages that are written in these
// words. A model reading the estate cold has the same problem a person has.
func TestLlmsListsTheGlossaries(t *testing.T) {
	body := page(t, "llms.txt")

	if !strings.Contains(body, "## Glossaries") {
		t.Fatalf("no Glossaries section:\n%s", body)
	}
	if !strings.Contains(body, "[Glossary of Billing](billing/glossary.md): 2 terms. Dunning, Invoice") {
		t.Errorf("the entry is not what it should be:\n%s", body)
	}
	if strings.Index(body, "## Glossaries") > strings.Index(body, "## Services") {
		t.Error("the glossaries sit after the services")
	}
}

// An estate that has written no glossary renders exactly as it did before
// there was one to write.
func TestAContextWithNoGlossaryGetsNoPage(t *testing.T) {
	raw, err := os.ReadFile("testdata/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var cat catalog.Catalog
	if err := json.Unmarshal(raw, &cat); err != nil {
		t.Fatal(err)
	}
	cat.Terms = nil

	for _, file := range render(plugin.Request{Catalog: cat}, Options{}).Files {
		if strings.HasSuffix(file.Name, glossaryFile) {
			t.Errorf("rendered %s for a catalog with no terms", file.Name)
		}
		if file.Name == "llms.txt" && strings.Contains(file.Contents, "Glossaries") {
			t.Error("llms.txt has a Glossaries section with no glossaries")
		}
		if file.Name == "billing/README.md" && strings.Contains(file.Contents, "## Language") {
			t.Error("the context page has a Language section with no terms")
		}
	}
}
