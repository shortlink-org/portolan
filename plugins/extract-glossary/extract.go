package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

var contextSlug = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// extract reads every glossary the options name and answers with one fragment
// holding their terms.
//
// A file that cannot be parsed fails the whole run rather than being left out:
// a fragment silently missing half a vocabulary is a site where a word simply
// has no meaning, with nothing on the page to say a file was skipped and why.
// What is merely incomplete - an entry that never says what the term is not,
// a glossary that drifted out of alphabetical order - comes back as warnings,
// which the host prints and nobody has to act on today.
func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}

	context := opts.Context
	if context == "" {
		context = filepath.Base(in.Root)
	}
	if !contextSlug.MatchString(context) {
		return plugin.Response{}, errors.New(context + " is not a context slug: a term's id is the context and the term, so the context has to be one word the way the estate spells it")
	}

	patterns := opts.Files
	if len(patterns) == 0 {
		patterns = []string{"GLOSSARY.md"}
	}
	var files []string
	seen := map[string]bool{}
	for _, pattern := range patterns {
		matches, err := filepath.Glob(filepath.Join(in.Root, pattern))
		if err != nil {
			return plugin.Response{}, err
		}
		for _, match := range matches {
			if !seen[match] {
				seen[match] = true
				files = append(files, match)
			}
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		b.Warn(in.Root, "no glossary matched "+strings.Join(patterns, ", ")+"; the fragment holds no terms")
	}

	terms := []catalog.Term{}
	ids := map[string]string{}
	var problems []string
	for _, file := range files {
		src, err := os.ReadFile(file)
		if err != nil {
			return plugin.Response{}, err
		}
		rel := filepath.ToSlash(file)
		parsed, warns, errs := parseGlossary(rel, context, string(src))
		if len(errs) > 0 {
			problems = append(problems, errs...)

			continue
		}
		for _, warn := range warns {
			b.Warn(rel, strings.TrimPrefix(warn, rel+": "))
		}
		for _, term := range parsed {
			// Two files in one context defining one word is the failure the
			// glossary exists to prevent, said in the glossaries themselves.
			if other, taken := ids[term.ID]; taken {
				problems = append(problems, term.Source+": "+term.Name+" is already defined in "+other)

				continue
			}
			ids[term.ID] = term.Source
			terms = append(terms, term)
		}
	}
	if len(problems) > 0 {
		return plugin.Response{}, errors.New(strings.Join(problems, "\n"))
	}

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts:    []catalog.BoundedContext{},
		Defs:        map[string]catalog.TypeDef{},
		Flows:       []catalog.Flow{},
		Adrs:        []catalog.Adr{},
		Terms:       terms,
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	out := opts.Out
	if out == "" {
		out = "glossary.json"
	}
	b.File(out, string(encoded)+"\n")

	return b.Response(), nil
}
