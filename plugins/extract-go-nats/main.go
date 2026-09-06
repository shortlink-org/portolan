// Package main is portolan-extract-go-nats: nats.go and JetStream calls in a
// Go repository in, the subjects the service listens on and publishes to out.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Context string `json:"context"`
	Service string `json:"service"`
	Out     string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-go-nats:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: an extractor has nothing to read")
		}
		if opts.Context == "" {
			opts.Context = goscan.Slug(filepath.Base(req.Input.Root))
		}
		if opts.Service == "" {
			opts.Service = goscan.Slug(filepath.Base(req.Input.Root))
		}

		return extract(req.Input, opts)
	})
}
