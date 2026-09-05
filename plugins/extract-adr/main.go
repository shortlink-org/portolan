// Command extract-adr reads decision records written by hand, as the MADR
// markdown they already are, and answers with a catalog fragment.
//
// A decision is written down once, in a file beside the code it constrains,
// and it is read there by whoever changed that code. Typing it a second time
// into the catalog's JSON - as an id, a slug, a number, a scope and a body
// with every newline escaped - makes the JSON the source and the markdown a
// copy, which is the arrow pointing the wrong way: the copy is the one that
// goes stale, and the three records that lived in `data/catalog.json` before
// this plugin existed all pointed at files that were never there.
//
// So the markdown is the source and the fragment is the output. What the
// format cannot say - which service a record belongs to, whether the record
// is still in force - it says in bullets under the title, and everything from
// the first `##` onward is the record itself, carried through untouched. The
// format is described in plugins/README.md and held to by parse_test.go.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor.
type Options struct {
	// Files are the record files to read, as globs relative to the input
	// root. Left out, every `docs/adr/*.md`, which is where a service keeps
	// them; an estate-wide step points its own glob somewhere else.
	Files []string `json:"files,omitempty"`

	// Out names the fragment file.
	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-adr:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: an extractor has nothing to read")
		}

		return extract(req.Input, opts)
	})
}
