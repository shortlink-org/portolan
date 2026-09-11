// Package extractargocd is portolan-extract-argocd: the Argo CD Applications
// and ApplicationSets in a GitOps tree in, the deployments they declare out.
//
// It reads what should run - which service, from which directory of which
// repository, into which cluster and namespace, tracking which revision -
// and never what does: no sync state, no revision synced, no running image.
// Those are the deployer's to say (portolan.0012) and a fetcher reads them;
// the merge lays the two over each other and calls the difference drift
// (portolan.0013).
//
// An ApplicationSet is expanded the way the controller expands it, as far
// as a tree can: list generators whole, git generators by walking the same
// repository, matrix over those. A generator that needs a cluster, a forge
// or a plugin is passed over with a warning that names it.
package extractargocd

import (
	"fmt"
	"io"

	"github.com/shortlink-org/portolan/plugin"
)

// Labels are the Application labels that name the service it deploys, the
// Kubernetes recommended ones unless the manifest says otherwise - the same
// pair fetch-k8s and fetch-argocd read.
type Labels struct {
	Context string `json:"context,omitempty"`
	Service string `json:"service,omitempty"`
}

type Options struct {
	Repo             string   `json:"repo,omitempty"`
	EnvironmentLabel string   `json:"environmentLabel,omitempty"`
	Labels           Labels   `json:"labels,omitempty"`
	Paths            []string `json:"paths,omitempty"`
	Out              string   `json:"out,omitempty"`
}

const (
	defaultEnvironmentLabel = "env"
	defaultContextLabel     = "app.kubernetes.io/part-of"
	defaultServiceLabel     = "app.kubernetes.io/name"
	defaultOut              = "argocd.json"
)

// Serve answers one request on stdin with one response on stdout. The
// process entrypoint and the wasm dispatcher in plugins/cmd/portolan-go both
// call it.
func Serve(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: an extractor has nothing to read")
		}
		// Input.Root is repository-relative and the workspace is the
		// repository, so a git generator's repository-relative path is
		// walked from here.
		return extract(req.Input, opts, ".")
	})
}

func (o Options) withDefaults() Options {
	if o.EnvironmentLabel == "" {
		o.EnvironmentLabel = defaultEnvironmentLabel
	}
	if o.Labels.Context == "" {
		o.Labels.Context = defaultContextLabel
	}
	if o.Labels.Service == "" {
		o.Labels.Service = defaultServiceLabel
	}
	if o.Out == "" {
		o.Out = defaultOut
	}
	return o
}
