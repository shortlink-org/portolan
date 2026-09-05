package main

// The vocabulary of one context, as a page of its own.
//
// It is not folded into the context's README for the same reason the source
// is its own file: the README says what the services do, the glossary says
// what the words in that sentence mean, and a reader consults them at
// different moments. It is also the page a model reading this estate wants
// FIRST - every other page is written in these words.
//
// Nothing here is derived. A definition is the author's sentence, carried
// through as written, and the only thing this file decides is the order it is
// read in and where the words came from.

import (
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

const glossaryFile = "glossary.md"

// glossaryPath is where a context's vocabulary is documented: beside its
// README, so the two sit together in the tree the way they sit together in
// the repository the terms were read from.
func (s *site) glossaryPath(ctx *catalog.BoundedContext) string {
	return ctx.Slug + "/" + glossaryFile
}

func (s *site) renderGlossary(ctx *catalog.BoundedContext) {
	terms := s.termsOf[ctx.ID]
	if len(terms) == 0 {
		return
	}
	self := s.glossaryPath(ctx)

	var b strings.Builder
	b.WriteString("# Glossary — " + ctx.Name + "\n\n")
	b.WriteString(s.stamp() + "\n")
	b.WriteString(defList([][]string{
		{"Context", s.ref(self, ctx.ID, ctx.Name)},
		{"Terms", strconv.Itoa(len(terms))},
		{"Read from", strings.Join(s.termSources(self, terms), ", ")},
	}))

	b.WriteString("\nOne meaning per word inside this context, as the glossary" +
		" beside the code states it.\n")

	// A list rather than a table. A definition is a sentence or two of prose,
	// and a table cell is where a sentence goes to be truncated - the same
	// reason the source file is prose. A list also diffs by the term.
	var out strings.Builder
	for _, term := range terms {
		out.WriteString("- **" + term.Name + "** — " + term.Definition + "\n")
	}
	section(&b, "Terms", out.String())

	s.b.file(self, b.String())
}

func (s *site) termSources(from string, terms []*catalog.Term) []string {
	seen := map[string]bool{}
	var out []string
	for _, term := range terms {
		file := sourceFile(term.Source)
		if file == "" || seen[file] {
			continue
		}
		seen[file] = true
		out = append(out, s.source(from, file, s.serviceForSource(file)))
	}
	sort.Strings(out)
	return out
}
