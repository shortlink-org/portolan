// Package extractk8s is portolan-extract-k8s: the Kubernetes manifests in a
// repository in, the names a service answers on and the in-cluster names it
// is configured to dial out.
//
// It reads topology and never configuration. A value from an environment
// variable or a config map is looked at once, in memory, for one purpose -
// does it name a host inside the cluster - and what is written is the host
// alone. Secrets are not opened at all.
package extractk8s

import (
	"fmt"
	"io"
	"path/filepath"

	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Context   string   `json:"context"`
	Service   string   `json:"service"`
	Paths     []string `json:"paths,omitempty"`
	Namespace string   `json:"namespace,omitempty"`
	Out       string   `json:"out,omitempty"`
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
