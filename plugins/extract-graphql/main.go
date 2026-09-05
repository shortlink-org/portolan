// Package main is portolan-extract-graphql: a GraphQL schema in, a catalog
// fragment out.
//
// It describes one aspect of a service - what a client may ask it for - and
// nothing else. Who answers underneath is a different fact, read by whichever
// extractor reads the resolvers, and the two meet in the merge. Neither knows
// the other exists, which is the whole reason each of them stays small.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor: the things a schema does
// not say about the estate it belongs to.
type Options struct {
	Context string `json:"context"`
	Service string `json:"service"`

	// Schema is the document or the directory of documents, relative to the
	// input root. Left out, the extractor looks for them.
	Schema string `json:"schema,omitempty"`

	// API prefixes the ids of the interfaces this produces. Left out, it is
	// the service and a major version - `bff` gives `bff.v1`, and a module
	// called `basket` gives `bff.v1.Basket`.
	API string `json:"api,omitempty"`

	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-graphql:", err)
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
