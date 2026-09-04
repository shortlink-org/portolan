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

// extract reads every flow file the options name and answers with one
// fragment holding the flows. A file that does not parse fails the whole run,
// the way a compiler would: a flow written by hand is written to be read, and
// one silently left out of the catalog is the kind of missing nobody notices.
func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}

	patterns := opts.Files
	if len(patterns) == 0 {
		patterns = []string{"*.flow.md"}
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
		b.Warn(in.Root, "no flow files matched "+strings.Join(patterns, ", ")+"; the fragment holds no flows")
	}

	flows := []catalog.Flow{}
	var problems []string
	slugs := map[string]string{}
	for _, file := range files {
		src, err := os.ReadFile(file)
		if err != nil {
			return plugin.Response{}, err
		}
		rel := filepath.ToSlash(file)
		flow, errs := parseFlow(rel, string(src))
		if len(errs) > 0 {
			problems = append(problems, errs...)

			continue
		}
		if other, taken := slugs[flow.Slug]; taken {
			problems = append(problems, rel+": flow "+flow.Slug+" is already declared in "+other)

			continue
		}
		slugs[flow.Slug] = rel
		flows = append(flows, flow)
	}
	if len(problems) > 0 {
		return plugin.Response{}, errors.New(strings.Join(problems, "\n"))
	}

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts:    []catalog.BoundedContext{},
		Defs:        map[string]catalog.TypeDef{},
		Flows:       flows,
		Adrs:        []catalog.Adr{},
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	out := opts.Out
	if out == "" {
		out = "flows.json"
	}
	b.File(out, string(encoded)+"\n")

	return b.Response(), nil
}
