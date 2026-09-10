package extractcommands

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"regexp"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/commands"
	"github.com/shortlink-org/portolan/plugin"
)

var slug = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// extract reads the runner files at the root and answers with a fragment
// that names the service and lists its commands - and nothing else about
// it, because everything else is another extractor's to say.
//
// A runner file that cannot be read comes back as a warning rather than a
// failure: a broken Taskfile is a fact about the checkout the page can carry,
// and the other runners' commands are still worth listing.
func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}

	service := opts.Service
	if service == "" {
		service = filepath.Base(in.Root)
	}
	context := opts.Context
	if context == "" {
		context = filepath.Base(filepath.Dir(in.Root))
	}
	for _, part := range []string{context, service} {
		if !slug.MatchString(part) {
			return plugin.Response{}, errors.New(part + " is not a slug: a service's id is the context and the service, so both have to be one word the way the estate spells them")
		}
	}

	cmds, warnings := commands.Read(in.Root)
	for _, warning := range warnings {
		b.Warn(in.Root, warning)
	}
	if len(cmds) == 0 {
		b.Warn(in.Root, "no runner file declares a command here - no Makefile, justfile, Taskfile, package.json scripts or pyproject tasks - so the fragment lists none")
	}

	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID:   context,
			Slug: context,
			Services: []catalog.Service{{
				ID:         context + "." + service,
				Slug:       service,
				Provides:   []catalog.RpcService{},
				Consumes:   []catalog.RpcCall{},
				Aggregates: []catalog.Aggregate{},
				Commands:   cmds,
			}},
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{},
		Adrs:  []catalog.Adr{},
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	out := opts.Out
	if out == "" {
		out = "commands.json"
	}
	b.File(out, string(encoded)+"\n")

	return b.Response(), nil
}
