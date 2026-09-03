// Package main is portolan-extract-go: a Go service in, a catalog fragment out.
//
// It reads the source with go/parser alone - no go/packages, no `go list`, no
// module download. The domain layer of a service laid out this way is regular
// enough that the syntax carries the answer, and staying out of the toolchain
// means the extractor runs on a checkout that has never been built.
//
// What it does not know, it says. An aggregate whose root it cannot identify,
// an event with no name, a use case it cannot classify - each is a diagnostic
// beside the fragment rather than a guess inside it.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor. Everything here is a fact
// about the estate that the source does not carry: a Go module knows its own
// import path, not which bounded context it belongs to.
type Options struct {
	Context        string `json:"context"`
	ContextName    string `json:"contextName,omitempty"`
	ContextSummary string `json:"contextSummary,omitempty"`
	Classification string `json:"classification,omitempty"`

	Service     string `json:"service"`
	ServiceName string `json:"serviceName,omitempty"`
	Repo        string `json:"repo,omitempty"`

	// Store is the slug of the database this service keeps its state in - the
	// same one the SQL extractor is given. It is here for the flows: a call on
	// a repository lands somewhere, and only the manifest knows where.
	Store string `json:"store,omitempty"`

	// Peers says which service answers to a proto package this service calls:
	// {"risk.v1": "shop.risk"}. The generated client in the tree names the
	// package and the rpc; only the manifest knows whose it is. A package
	// with no line here is called as `unknown`, and the steps are unresolved.
	Peers map[string]string `json:"peers,omitempty"`

	// Out names the fragment file. One extractor, one file, so that a fragment
	// carries the provenance of the run that produced it.
	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-go:", err)
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
