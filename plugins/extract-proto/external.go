package extractproto

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// extractExternal reads the copy of a contract nobody in the estate publishes:
// the protos a service vendored beside the adapter that calls a system outside
// it. What the copy declares is all the catalog may claim about that system,
// so the fragment carries the external and what it answers on, and nothing
// else - no service, no module, no shared types.
//
// The module is left out on purpose. A module is a thing the estate publishes
// or pins, and this copy is neither: it is a narrowed excerpt the caller keeps
// for itself. Its types stay on its own interfaces rather than becoming defs,
// for the same reason a vendored copy's do.
func extractExternal(in plugin.Input, opts Options, b *plugin.Builder) (plugin.Response, error) {
	if strings.Contains(opts.External, ".") {
		return plugin.Response{}, fmt.Errorf("external %q has a dot in its id; an external sits at the root and is addressed by a bare name", opts.External)
	}

	dirs, err := readDirs(in.Root, opts.Paths, b)
	if err != nil {
		return plugin.Response{}, err
	}

	var provides []catalog.RpcService
	for _, dir := range dirs {
		provides = append(provides, interfaces(NewIndex(dir.files), dir.files, "", newShared(false), b)...)
	}
	if len(provides) == 0 {
		b.Warn(opts.External, "no proto service was found under "+strings.Join(opts.Paths, ", "))
	}
	for i := range provides {
		provides[i].Source = in.RepositorySource(provides[i].Source)
	}

	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{},
		Defs:     map[string]catalog.TypeDef{},
		Flows:    []catalog.Flow{},
		Adrs:     []catalog.Adr{},
		Externals: []catalog.External{{
			ID:       opts.External,
			Slug:     opts.External,
			Name:     opts.ExternalName,
			Summary:  opts.ExternalSummary,
			URL:      opts.ExternalURL,
			Provides: nonNilProvides(provides),
		}},
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}

	b.File(firstNonEmpty(opts.Out, "proto.json"), string(encoded)+"\n")

	return b.Response(), nil
}
