// Package extractgo is portolan-extract-go: a Go service in, a catalog fragment out.
//
// It reads the source with go/parser alone - no go/packages, no `go list`, no
// module download. The domain layer of a service laid out this way is regular
// enough that the syntax carries the answer, and staying out of the toolchain
// means the extractor runs on a checkout that has never been built.
//
// What it does not know, it says. An aggregate whose root it cannot identify,
// an event with no name, a use case it cannot classify - each is a diagnostic
// beside the fragment rather than a guess inside it.
package extractgo

import (
	"fmt"
	"io"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor. Everything here is a fact
// about the estate that the source does not carry: a Go module knows its own
// import path, not which bounded context it belongs to.
type Options struct {
	Context        string `json:"context"`
	ContextName    string `json:"contextName,omitempty"`
	ContextSummary string `json:"contextSummary,omitempty"`
	Classification string `json:"classification,omitempty"`

	Service     string `json:"service"`
	ServiceName string `json:"serviceName,omitempty"`
	Repo        string `json:"repo,omitempty"`
	// Scope is the deployable name in a shared Go module. When present, the
	// extractor owns only internal/<scope> and reads its HTTP/gRPC entrypoints;
	// imported packages are still followed so a handler can reach application
	// code in the same feature slice.
	Scope string `json:"scope,omitempty"`

	// Store is the slug of the database this service keeps its state in - the
	// same one the SQL extractor is given. It is here for the flows: a call on
	// a repository lands somewhere, and only the manifest knows where.
	Store string `json:"store,omitempty"`

	// Peers says which service answers to a proto package this service calls:
	// {"risk.v1": "shop.risk"}. The generated client in the tree names the
	// package and the rpc; only the manifest knows whose it is. A package
	// with no line here is called as `unknown`, and the steps are unresolved.
	Peers map[string]string `json:"peers,omitempty"`

	// Externals says which system outside the estate answers to an api this
	// service calls, as the api id to the external's bare id: {"stripe.v1":
	// "stripe"}. Written when the name the document would give the system is
	// not the one wanted; left out, a generated HTTP client whose package no
	// peers line claims is read as calling the system its vendored document
	// is titled after.
	Externals map[string]string `json:"externals,omitempty"`

	// Events says which aggregate another service's events belong to, as the
	// import path a policy reads them from to the aggregate id. A service that
	// vendors the shape of somebody else's event has the type and nothing else;
	// only the manifest knows whose aggregate raised it.
	Events map[string]string `json:"events,omitempty"`

	// Out names the fragment file. One extractor, one file, so that a fragment
	// carries the provenance of the run that produced it.
	Out string `json:"out,omitempty"`
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
