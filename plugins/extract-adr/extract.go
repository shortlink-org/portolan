package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// extract reads every record the options name and answers with one fragment
// holding them. A file that does not parse fails the whole run rather than
// being left out of the fragment: `src/catalog.ts` refuses to load a catalog
// whose records break any of these rules, so a half fragment written here
// would be a blank site later, with the reason a long way from the file that
// caused it.
func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}

	patterns := opts.Files
	if len(patterns) == 0 {
		patterns = []string{"docs/adr/*.md"}
	}
	var files []string
	seen := map[string]bool{}
	for _, pattern := range patterns {
		matches, err := filepath.Glob(filepath.Join(in.Root, pattern))
		if err != nil {
			return plugin.Response{}, err
		}
		for _, match := range matches {
			// A README in a directory of records is its index - written by
			// hand or generated elsewhere - and is not itself a decision.
			if strings.EqualFold(filepath.Base(match), "README.md") {
				continue
			}
			if !seen[match] {
				seen[match] = true
				files = append(files, match)
			}
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		b.Warn(in.Root, "no decision records matched "+strings.Join(patterns, ", ")+"; the fragment holds none")
	}

	adrs := []catalog.Adr{}
	var problems []string
	ids := map[string]string{}
	slugs := map[string]string{}
	for _, file := range files {
		src, err := os.ReadFile(file)
		if err != nil {
			return plugin.Response{}, err
		}
		rel := filepath.ToSlash(file)
		adr, errs := parseAdr(rel, string(src))
		if len(errs) > 0 {
			problems = append(problems, errs...)

			continue
		}
		if other, taken := ids[adr.ID]; taken {
			problems = append(problems, rel+": "+adr.ID+" is already declared in "+other)

			continue
		}
		if other, taken := slugs[adr.Slug]; taken {
			problems = append(problems, rel+": the slug "+adr.Slug+" is already taken by "+other)

			continue
		}
		ids[adr.ID] = rel
		slugs[adr.Slug] = rel
		adrs = append(adrs, adr)
	}
	problems = append(problems, supersessions(adrs, ids)...)
	if len(problems) > 0 {
		return plugin.Response{}, errors.New(strings.Join(problems, "\n"))
	}

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts:    []catalog.BoundedContext{},
		Defs:        map[string]catalog.TypeDef{},
		Flows:       []catalog.Flow{},
		Adrs:        adrs,
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	out := opts.Out
	if out == "" {
		out = "adr.json"
	}
	b.File(out, string(encoded)+"\n")

	return b.Response(), nil
}

// supersessions holds the two halves of a supersession against each other.
//
// Only the halves that are both here can be checked: a record superseded by
// one in another service's tree is a claim this step has no way to look up,
// and the validator, which sees the merged catalog, reports that one. What
// this catches is the common case - a record superseded by its neighbour,
// with only one of the two files edited.
func supersessions(adrs []catalog.Adr, ids map[string]string) []string {
	var problems []string

	by := map[string]*catalog.Adr{}
	for i := range adrs {
		by[adrs[i].ID] = &adrs[i]
	}
	names := func(list []string, id string) bool {
		for _, entry := range list {
			if entry == id {
				return true
			}
		}

		return false
	}

	for i := range adrs {
		adr := &adrs[i]
		where := ids[adr.ID] + ": "
		if successor, here := by[adr.SupersededBy]; here && !names(successor.Supersedes, adr.ID) {
			problems = append(problems, where+adr.ID+" is superseded by "+successor.ID+", which does not say it supersedes it")
		}
		for _, id := range adr.Supersedes {
			if predecessor, here := by[id]; here && predecessor.SupersededBy != adr.ID {
				problems = append(problems, where+adr.ID+" supersedes "+id+", which is not marked superseded by it")
			}
		}
		if adr.SupersededBy == adr.ID {
			problems = append(problems, where+adr.ID+" supersedes itself")
		}
	}

	return problems
}
