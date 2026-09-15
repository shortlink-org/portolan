// Package extracthttpclients is portolan-extract-http-clients: outbound HTTP and SOAP calls
// in a Go repository in, source-backed dependencies and flows out.
package extracthttpclients

import (
	"encoding/json"
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
	// Adapters names the system a hand-written client reaches, keyed by the
	// directory the adapter lives in. A generated client carries its contract
	// and names its own peer; a hand-written one only names a verb, a path and
	// a base URL read from configuration, so the manifest has to say what is
	// on the other end.
	Adapters map[string]Adapter `json:"adapters,omitempty"`
	Out      string             `json:"out,omitempty"`
}

// Adapter is what the manifest says about the system behind one adapter
// directory: the external's bare id, and what to call it on the page; or a
// service of the estate and the interface it answers the calls on.
type Adapter struct {
	External string `json:"external,omitempty"`
	// Service and API name a catalog service and an interface it provides,
	// such as an OpenAPI document its own extractor read. A call is then the
	// operation of that interface its verb and path name.
	Service string `json:"service,omitempty"`
	API     string `json:"api,omitempty"`
	Name    string `json:"name,omitempty"`
	Summary string `json:"summary,omitempty"`
	URL     string `json:"url,omitempty"`
}

// UnmarshalJSON takes the short form, a bare external id, as well as the
// object.
func (a *Adapter) UnmarshalJSON(data []byte) error {
	var id string
	if err := json.Unmarshal(data, &id); err == nil {
		*a = Adapter{External: id}
		return nil
	}
	type plain Adapter
	var full plain
	if err := json.Unmarshal(data, &full); err != nil {
		return err
	}
	*a = Adapter(full)
	return nil
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
