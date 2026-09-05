// Package main is portolan-extract-openapi: an OpenAPI document in, a catalog
// fragment out.
//
// It describes one aspect of a service - what it answers - and nothing else.
// The aggregates come from a different extractor reading a different part of
// the tree, and the two meet in the merge. Neither knows the other exists,
// which is the whole reason each of them stays small.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor: the things an OpenAPI
// document does not say about the estate it belongs to.
type Options struct {
	Context string `json:"context"`
	Service string `json:"service"`

	// Spec is the document, relative to the input root. Left out, the
	// extractor looks for one.
	Spec string `json:"spec,omitempty"`

	// API prefixes the ids of the rpc services this produces. Left out, it is
	// built from the document's title and major version - `auth` 1.0.0 gives
	// `auth.v1`, and a tag called `users` gives `auth.v1.Users`.
	API string `json:"api,omitempty"`

	// External names a system outside the estate the document belongs to,
	// when it is not one of ours: the copy vendored beside an adapter, read
	// for what the third party answers on. Set, the fragment carries no
	// context and no service, only the external, and `context` and `service`
	// are not read.
	External        string `json:"external,omitempty"`
	ExternalName    string `json:"externalName,omitempty"`
	ExternalSummary string `json:"externalSummary,omitempty"`
	ExternalURL     string `json:"externalUrl,omitempty"`

	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-openapi:", err)
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
