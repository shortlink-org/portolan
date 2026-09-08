// Package extracthttpclients is portolan-extract-http-clients: outbound HTTP and SOAP calls
// in a Go repository in, source-backed dependencies and flows out.
package extracthttpclients

import (
	"fmt"
	"io"
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
			opts.Context = slug(filepath.Base(req.Input.Root))
		}
		if opts.Service == "" {
			opts.Service = slug(filepath.Base(req.Input.Root))
		}
		return extract(req.Input, opts)
	})
}
