package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// Where a forge looks for the file, in the order it looks.
var places = []string{"CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"}

// verify reads the file and answers with who owns each service.
//
// The catalog it is handed is the merged one, which is the only thing that
// knows where each service is: a rule is a path, a service has a path, and
// nothing else in the estate holds both. That is also why this is a verifier
// rather than an extractor - an extractor is handed a directory and would have
// to be told, service by service, in the manifest, what the catalog already
// says.
func verify(req plugin.Request, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}

	at, src, err := read(req.Input.Root, opts.File)
	if err != nil {
		return plugin.Response{}, err
	}
	rel := filepath.ToSlash(at)

	parsed := parseCodeowners(src)
	if parsed.Sections {
		b.Warn(rel, "uses section headers, which change whose rule wins; owners are resolved the way a forge without sections resolves them, so a service may be missing one")
	}
	if len(parsed.Rules) == 0 {
		b.Warn(rel, "states no rules; no service is owned by anybody")
	}

	// Two different things a rule can fail at, told apart because the fix is
	// different. A rule that matches nothing names a path the estate does not
	// have - a typo, or a directory that moved. A rule that matches something
	// and never wins is alive but unreachable: everything it covers is claimed
	// further down, and deleting it would change nothing.
	matched := make([]bool, len(parsed.Rules))
	won := make([]bool, len(parsed.Rules))
	contexts := []catalog.BoundedContext{}

	for _, context := range req.Catalog.Contexts {
		owned := []catalog.Service{}

		for _, service := range context.Services {
			if service.Path == "" {
				b.Warn(service.ID, "has no path, so no rule can be matched against it")

				continue
			}

			// LAST match wins, so the search runs backwards and stops at the
			// first hit. A rule that matches and names nobody still wins:
			// taking ownership back is what an empty rule is written for.
			handles := []string{}
			first := true
			for i := len(parsed.Rules) - 1; i >= 0; i-- {
				if !owns(parsed.Rules[i].Pattern, service.Path) {
					continue
				}
				matched[i] = true
				if first {
					first = false
					won[i] = true
					handles = append(handles, parsed.Rules[i].Owners...)
				}
			}
			if len(handles) == 0 {
				b.Warn(service.ID, "is owned by nobody in "+rel)

				continue
			}

			owned = append(owned, catalog.Service{
				ID:         service.ID,
				Slug:       service.Slug,
				Provides:   []catalog.RpcService{},
				Consumes:   []catalog.RpcCall{},
				Aggregates: []catalog.Aggregate{},
				Owners:     handles,
			})
		}

		if len(owned) == 0 {
			continue
		}
		contexts = append(contexts, catalog.BoundedContext{
			ID:       context.ID,
			Slug:     context.ID,
			Services: owned,
		})
	}

	// The half of this that is a verification rather than a reading: a rule
	// nobody matched is a team that believes it owns something it does not,
	// which is the failure a CODEOWNERS file has and never reports.
	for i, rule := range parsed.Rules {
		where := fmt.Sprintf("%s:%d", rel, rule.Line)
		switch {
		case !matched[i]:
			b.Warn(where, rule.Pattern+" matches no service in the catalog")
		case !won[i]:
			b.Warn(where, rule.Pattern+" owns no service: everything it matches is claimed by a rule below it")
		}
	}

	fragment := catalog.Catalog{
		GeneratedAt: req.Input.GeneratedAt,
		Commit:      req.Input.Commit,
		Contexts:    contexts,
		Defs:        map[string]catalog.TypeDef{},
		Flows:       []catalog.Flow{},
		Adrs:        []catalog.Adr{},
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}

	out := opts.Out
	if out == "" {
		out = "owners.json"
	}
	b.File(out, string(encoded)+"\n")

	return b.Response(), nil
}

// read finds the file and returns where it was and what it says.
//
// A named file that is not there fails the run: somebody wrote that path in
// the manifest, and answering "nobody owns anything" to a typo is the kind of
// wrong that is only noticed when a page has been missing an owner for a
// month. Nothing named and nothing found is the same failure said differently,
// because a step declared at all is a step that expected a file.
func read(root, named string) (string, string, error) {
	tried := places
	if named != "" {
		tried = []string{named}
	}

	for _, place := range tried {
		at := filepath.Join(root, filepath.FromSlash(place))
		src, err := os.ReadFile(at)
		if err == nil {
			return at, string(src), nil
		}
		if !os.IsNotExist(err) {
			return "", "", err
		}
	}

	return "", "", fmt.Errorf("no CODEOWNERS under %s: looked for %s",
		filepath.ToSlash(root), strings.Join(tried, ", "))
}
