// Package main is portolan-extract-openapi: an OpenAPI document in, a catalog
// fragment out.
//
// It describes one aspect of a service - what it answers - and nothing else.
// The aggregates come from a different extractor reading a different part of
// the tree, and the two meet in the merge. Neither knows the other exists,
// which is the whole reason each of them stays small.
package main

import (
	"encoding/json"
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

	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-openapi:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	in, err := io.ReadAll(stdin)
	if err != nil {
		return fmt.Errorf("reading the request: %w", err)
	}

	var req plugin.Request
	if err := json.Unmarshal(in, &req); err != nil {
		return fmt.Errorf("the request is not a portolan plugin request: %w", err)
	}

	var opts Options
	if len(req.Options) > 0 {
		if err := json.Unmarshal(req.Options, &opts); err != nil {
			return fmt.Errorf("options: %w", err)
		}
	}

	if req.Input.Root == "" {
		return fmt.Errorf("no input root: an extractor has nothing to read")
	}

	resp, err := extract(req.Input, opts)
	if err != nil {
		return err
	}

	out, err := json.Marshal(resp)
	if err != nil {
		return fmt.Errorf("encoding the response: %w", err)
	}

	if _, err := stdout.Write(out); err != nil {
		return fmt.Errorf("writing the response: %w", err)
	}

	return nil
}
