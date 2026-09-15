package extractrfc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	patterns := opts.Files
	if len(patterns) == 0 {
		patterns = []string{"docs/rfc/*.md", "docs/rfcs/*.md", "docs/rfd/*.md"}
	}
	seenFiles := map[string]bool{}
	var files []string
	for _, pattern := range patterns {
		matches, err := filepath.Glob(filepath.Join(in.Root, pattern))
		if err != nil {
			return plugin.Response{}, err
		}
		for _, file := range matches {
			if strings.EqualFold(filepath.Base(file), "README.md") || seenFiles[file] {
				continue
			}
			seenFiles[file] = true
			files = append(files, file)
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		b.Warn(in.Root, "no RFC records matched "+strings.Join(patterns, ", ")+"; the fragment holds none")
	}

	history := newHistory(in, opts.History, b)
	ids := map[string]string{}
	slugs := map[string]string{}
	rfcs := []catalog.Rfc{}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			return plugin.Response{}, err
		}
		relPath, err := filepath.Rel(in.Root, file)
		if err != nil {
			return plugin.Response{}, err
		}
		rel := filepath.ToSlash(relPath)
		rfc, problems := parseRFC(rel, string(raw), opts)
		if len(problems) > 0 {
			b.Warn(rel, "left out of the fragment: "+strings.Join(problems, "; "))
			continue
		}
		if other := ids[rfc.ID]; other != "" {
			b.Warn(rel, "left out of the fragment: "+rfc.ID+" is already declared in "+other)
			continue
		}
		if other := slugs[rfc.Slug]; other != "" {
			b.Warn(rel, "left out of the fragment: slug "+rfc.Slug+" is already declared in "+other)
			continue
		}
		ids[rfc.ID], slugs[rfc.Slug] = rel, rel
		// The host keys the history by the workspace spelling (portolan.0007),
		// the root joined in; the record names the file from its repository.
		rfc.Created, rfc.Revised = history.of(file)
		rfc.Source = in.RootPath(rel)
		if rfc.CreatedAt == "" && rfc.Created != nil {
			rfc.CreatedAt = rfc.Created.Date
		}
		if rfc.UpdatedAt == "" && rfc.Revised != nil {
			rfc.UpdatedAt = rfc.Revised.Date
		}
		rfcs = append(rfcs, rfc)
	}

	fragment := catalog.Catalog{Contexts: []catalog.BoundedContext{}, Defs: map[string]catalog.TypeDef{}, Flows: []catalog.Flow{}, Adrs: []catalog.Adr{}, Rfcs: rfcs}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	out := opts.Out
	if out == "" {
		out = "rfc.json"
	}
	b.File(out, string(encoded)+"\n")
	return b.Response(), nil
}
