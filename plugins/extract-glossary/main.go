// Command extract-glossary reads the vocabulary a bounded context speaks, as
// the GLOSSARY.md it is already written in, and answers with a catalog
// fragment.
//
// The glossary is the one file in a service that is written for a person and
// read by everyone: it says what a word means inside the boundary, and what it
// does NOT mean, which is where the confusion it was written to settle lives.
// Nothing generates it and nothing should - a definition is a decision about
// language, not a fact about code - so this plugin only reads.
//
// What it refuses is as much the point as what it parses. A table, a bullet
// list, a heading per term: all of them hold the same words, and every one of
// them makes the negative half of an entry either impossible to write or
// impossible to find. One shape, held to here, is what lets a page put "is"
// and "is not" on two lines everywhere in the estate. The format is described
// in plugins/README.md and held to by parse_test.go.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor.
type Options struct {
	// Context is the bounded context whose vocabulary this is. It is asked for
	// rather than derived because the file sits beside a SERVICE - shop.oms
	// keeps one, and the words in it belong to shop. Left out, the name of the
	// input directory, which is right only when the two coincide.
	Context string `json:"context,omitempty"`

	// Files are the glossaries to read, as globs relative to the input root.
	// Left out, `GLOSSARY.md` at the root of it, which is where the layout
	// rules put it - beside the README.
	Files []string `json:"files,omitempty"`

	// Out names the fragment file.
	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-glossary:", err)
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
