// Package extractsdd reads spec-driven development artifacts without
// treating intent, task completion, and implementation evidence as one fact.
package extractsdd

import (
	"io"

	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Root string `json:"root,omitempty"`
	Out  string `json:"out,omitempty"`
}

func Serve(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		return extract(req.Input, opts)
	})
}
