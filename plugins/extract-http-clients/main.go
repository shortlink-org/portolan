// Package main is portolan-extract-http-clients: outbound HTTP and SOAP calls
// in a Go repository in, source-backed dependencies and flows out.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Context   string            `json:"context"`
	Service   string            `json:"service"`
	Peers     map[string]string `json:"peers,omitempty"`
	Externals map[string]string `json:"externals,omitempty"`
	Out       string            `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-http-clients:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: an extractor has nothing to read")
		}
		if opts.Context == "" {
			opts.Context = slug(filepath.Base(req.Input.Root))
		}
		if opts.Service == "" {
			opts.Service = slug(filepath.Base(req.Input.Root))
		}
		return extract(req.Input, opts)
	})
}
