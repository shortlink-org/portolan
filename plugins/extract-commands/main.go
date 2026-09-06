// Command extract-commands reads what a developer types against a checkout -
// the make targets, npm scripts, just recipes and task-runner tasks the
// repository declares - and answers with a catalog fragment holding them on
// the service they belong to.
//
// It reads the runner files and nothing else. The README that says "run make
// test" is a claim; the Makefile with a test target is the fact. Fragment
// merging puts the list on the service the domain extractor described, so
// this plugin does not need to know anything else about it - only which
// service it is, which the manifest says.
//
// extract-project reads the same files for the component it describes, so a
// repository read by that plugin does not need this one; this is for the
// services a domain extractor describes instead.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor.
type Options struct {
	// Context is the bounded context the service is in. Left out, the name
	// of the input directory's parent - right for `shop/cart`, and wrong
	// often enough that the manifest should say.
	Context string `json:"context,omitempty"`

	// Service is the service the commands belong to, as its slug. Left out,
	// the name of the input directory.
	Service string `json:"service,omitempty"`

	// Out names the fragment file.
	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-commands:", err)
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
