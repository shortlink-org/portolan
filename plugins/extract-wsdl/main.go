// Package main is portolan-extract-wsdl: WSDL contracts and their local XSD
// graph in, structured SOAP interfaces in the catalog out.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/shortlink-org/portolan/internal/wsdl"
	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Context string `json:"context"`
	Service string `json:"service"`
	Spec    string `json:"spec,omitempty"`
	API     string `json:"api,omitempty"`

	// Mode is service for a contract implemented by this component, external
	// for copies used to call systems outside the estate.
	Mode      string            `json:"mode,omitempty"`
	External  string            `json:"external,omitempty"`
	Externals map[string]string `json:"externals,omitempty"`

	ExternalName    string `json:"externalName,omitempty"`
	ExternalSummary string `json:"externalSummary,omitempty"`
	ExternalURL     string `json:"externalUrl,omitempty"`
	Out             string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-wsdl:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: an extractor has nothing to read")
		}
		if opts.Context == "" {
			opts.Context = wsdl.Slug(filepath.Base(req.Input.Root))
		}
		if opts.Service == "" {
			opts.Service = wsdl.Slug(filepath.Base(req.Input.Root))
		}
		return extract(req.Input, opts)
	})
}
