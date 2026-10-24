package verifycodeowners

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

var githubPlaces = []string{".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"}
var gitlabPlaces = []string{"CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"}

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

	at, src, kind, err := read(req.Input.Root, opts.File)
	if err != nil {
		return plugin.Response{}, err
	}
	rel := filepath.ToSlash(at)

	parsed := parseCodeownersFor(src, kind)
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

			handles := resolveOwners(parsed, kind, service.Path, matched, won)
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
		case !won[i] && kind == gitHub:
			b.Warn(where, rule.Pattern+" owns no service: everything it matches is claimed by a rule below it")
		case !won[i]:
			b.Warn(where, rule.Pattern+" owns no service: it is overridden or excluded in its GitLab section")
		}
	}

	fragment := catalog.Catalog{
		Contexts: contexts,
		Defs:     map[string]catalog.TypeDef{},
		Flows:    []catalog.Flow{},
		Adrs:     []catalog.Adr{},
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
func read(root, named string) (string, string, dialect, error) {
	if named != "" {
		at := filepath.Join(root, filepath.FromSlash(named))
		body, err := os.ReadFile(at)
		if err != nil {
			return "", "", gitHub, err
		}
		src := string(body)
		return at, src, detectDialect(named, src), nil
	}

	allPlaces := []string{".github/CODEOWNERS", "CODEOWNERS", ".gitlab/CODEOWNERS", "docs/CODEOWNERS"}
	found := map[string]string{}
	for _, place := range allPlaces {
		at := filepath.Join(root, filepath.FromSlash(place))
		body, err := os.ReadFile(at)
		if err == nil {
			found[place] = string(body)
			continue
		}
		if !os.IsNotExist(err) {
			return "", "", gitHub, err
		}
	}
	if len(found) == 0 {
		return "", "", gitHub, fmt.Errorf("no CODEOWNERS under %s: looked for %s",
			filepath.ToSlash(root), strings.Join(allPlaces, ", "))
	}

	kind := gitHub
	for _, src := range found {
		if hasGitLabSyntax(src) {
			kind = gitLab
			break
		}
	}
	if kind == gitHub {
		_, hasGitHub := found[".github/CODEOWNERS"]
		_, hasGitLab := found[".gitlab/CODEOWNERS"]
		if !hasGitHub && hasGitLab {
			kind = gitLab
		}
	}

	places := githubPlaces
	if kind == gitLab {
		places = gitlabPlaces
	}
	for _, place := range places {
		if src, ok := found[place]; ok {
			return filepath.Join(root, filepath.FromSlash(place)), src, kind, nil
		}
	}
	// A dialect-specific file with syntax from the other forge is unusual but
	// still unambiguous input. Use the file that supplied the syntax signal.
	for _, place := range allPlaces {
		if src, ok := found[place]; ok {
			return filepath.Join(root, filepath.FromSlash(place)), src, kind, nil
		}
	}
	panic("unreachable")
}

func detectDialect(place, src string) dialect {
	if hasGitLabSyntax(src) {
		return gitLab
	}
	place = filepath.ToSlash(place)
	if strings.Contains("/"+place, "/.gitlab/CODEOWNERS") {
		return gitLab
	}
	return gitHub
}

func resolveOwners(parsed Parsed, kind dialect, target string, matched, won []bool) []string {
	if kind == gitHub {
		for i := len(parsed.Rules) - 1; i >= 0; i-- {
			if !ownsFor(kind, parsed.Rules[i].Pattern, target) {
				continue
			}
			matched[i] = true
			for j := i - 1; j >= 0; j-- {
				if ownsFor(kind, parsed.Rules[j].Pattern, target) {
					matched[j] = true
				}
			}
			won[i] = true
			return append([]string(nil), parsed.Rules[i].Owners...)
		}
		return nil
	}

	handles := []string{}
	seen := map[string]bool{}
	for _, section := range parsed.Order {
		winner := -1
		excluded := false
		for i, rule := range parsed.Rules {
			if rule.Section != section || !ownsFor(kind, rule.Pattern, target) {
				continue
			}
			matched[i] = true
			if excluded {
				continue
			}
			if rule.Exclude {
				excluded = true
				winner = -1
				won[i] = true
				continue
			}
			winner = i
		}
		if winner < 0 {
			continue
		}
		won[winner] = true
		owners := parsed.Rules[winner].Owners
		if len(owners) == 0 {
			owners = parsed.Defaults[section]
		}
		for _, owner := range owners {
			if !seen[owner] {
				seen[owner] = true
				handles = append(handles, owner)
			}
		}
	}
	return handles
}
