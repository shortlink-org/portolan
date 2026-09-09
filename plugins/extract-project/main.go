// Package extractproject is portolan-extract-project: a repository component in, a
// neutral catalog fragment out. It deliberately makes no DDD assumptions.
package extractproject

import (
	"fmt"
	"io"

	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Group          string `json:"group,omitempty"`
	GroupName      string `json:"groupName,omitempty"`
	GroupSummary   string `json:"groupSummary,omitempty"`
	GroupKind      string `json:"groupKind,omitempty"`
	Classification string `json:"classification,omitempty"`

	Component     string   `json:"component,omitempty"`
	ComponentName string   `json:"componentName,omitempty"`
	ComponentKind string   `json:"componentKind,omitempty"`
	Technologies  []string `json:"technologies,omitempty"`
	Repo          string   `json:"repo,omitempty"`
	Out           string   `json:"out,omitempty"`
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
		return extract(req.Input, opts)
	})
}
