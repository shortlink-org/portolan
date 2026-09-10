// Package extractterraform is portolan-extract-terraform: a Terraform module
// for AWS in, the queues, topics, functions and stores it declares out - and
// the edges between them that only the infrastructure knows.
package extractterraform

import (
	"fmt"
	"io"
	"path/filepath"

	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Context string `json:"context"`
	Service string `json:"service"`
	Dir     string `json:"dir,omitempty"`
	Out     string `json:"out,omitempty"`
}

// Serve answers one request on stdin with one response on stdout. The
// process entrypoint and the wasm dispatcher in plugins/cmd/portolan-go both
// call it.
func Serve(stdin io.Reader, stdout io.Writer) error {
	return run(stdin, stdout)
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
