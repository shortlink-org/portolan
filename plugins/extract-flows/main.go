// Command extract-flows reads flows written by hand, in a text form that reads
// like the sequence diagram it becomes, and answers with a catalog fragment.
//
// Some flows will always be written by people: the design doc for something
// not built yet, the reconstruction after an incident, the path a test does
// not pin. The catalog's JSON is the wrong place to write them - a tree of
// nodes, a unique id per step, every lane declared twice - so this is the
// right one: one file per flow, one line per hop, frames closed by `end`. The
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
	// Files are the flow files to read, as globs relative to the input root.
	// Left out, every `*.flow.md` directly under the root.
	Files []string `json:"files,omitempty"`

	// Out names the fragment file.
	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-flows:", err)
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
