// Package main is portolan-extract-project: a repository component in, a
// neutral catalog fragment out. It deliberately makes no DDD assumptions.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Group        string `json:"group,omitempty"`
	GroupName    string `json:"groupName,omitempty"`
	GroupSummary string `json:"groupSummary,omitempty"`
	GroupKind    string `json:"groupKind,omitempty"`

	Component     string   `json:"component,omitempty"`
	ComponentName string   `json:"componentName,omitempty"`
	ComponentKind string   `json:"componentKind,omitempty"`
	Technologies  []string `json:"technologies,omitempty"`
	Repo          string   `json:"repo,omitempty"`
	Out           string   `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-project:", err)
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
