// Package main is portolan-extract-asyncapi: an AsyncAPI document in, a catalog
// fragment out.
//
// It describes one aspect of a service - what it puts on the bus and what it
// listens for - and nothing else. The events themselves come from a different
// extractor reading the domain, and the two meet in the merge: that one says an
// aggregate raises BasketCreated and calls it `cart.BasketCreated` on the wire,
// this one says the service declares a channel carrying that name. Neither
// knows the other exists, and the pages hold the two against each other.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor: the things an AsyncAPI
// document does not say about the estate it belongs to.
type Options struct {
	Context string `json:"context"`
	Service string `json:"service"`

	// Spec is the document, relative to the input root. Left out, the
	// extractor looks for one.
	Spec string `json:"spec,omitempty"`

	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-asyncapi:", err)
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
