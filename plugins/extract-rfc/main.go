// Package extractrfc reads proposal and discussion records without applying
// ADR semantics to them. The source status is retained and only projected to
// a small lifecycle vocabulary for catalog navigation.
package extractrfc

import (
	"fmt"
	"io"

	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Files     []string          `json:"files,omitempty"`
	Scope     string            `json:"scope,omitempty"`
	Prefix    string            `json:"prefix,omitempty"`
	Repo      string            `json:"repo,omitempty"`
	History   string            `json:"history,omitempty"`
	StatusMap map[string]string `json:"statusMap,omitempty"`
	Out       string            `json:"out,omitempty"`
}

func Serve(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: an extractor has nothing to read")
		}
		return extract(req.Input, opts)
	})
}
