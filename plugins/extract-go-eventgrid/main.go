// Package extractgoeventgrid is portolan-extract-go-eventgrid: Azure Event
// Grid publisher calls in a Go repository in, the topics the service sends to out.
package extractgoeventgrid

import (
	"fmt"
	"io"
	"path/filepath"

	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Context string   `json:"context"`
	Service string   `json:"service"`
	Domains []string `json:"domains,omitempty"`
	Out     string   `json:"out,omitempty"`
}

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
