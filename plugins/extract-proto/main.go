// Package main is portolan-extract-proto: .proto files in, a catalog fragment
// out.
//
// It is a `process` plugin because it walks the input tree, and it would be a
// wasm one the day the host preopens `Input.Root`. Nothing in it reads a clock,
// opens a socket or looks at the environment, and nothing should: fetching a
// module from a registry belongs to portolan-fetch-bsr, and keeping the two
// apart is what lets this one be replayed byte-for-byte from a checkout.
//
// Wired into portolan.json for the order contract oms publishes; the shape of
// a step, with a vendored copy as well:
//
//	{
//	  "plugins": [
//	    { "name": "proto", "process": { "command": "go", "args": ["run", "./plugins/extract-proto"] } }
//	  ],
//	  "extract": [
//	    {
//	      "plugin": "proto",
//	      "in": "examples/shop",
//	      "out": "examples/shop/portolan",
//	      "options": {
//	        "context": "shop",
//	        "service": "oms",
//	        "paths": ["proto"],
//	        "vendored": ["internal/infrastructure/pricing"],
//	        "peers": { "shop.v1": "shop.pricing" },
//	        "out": "proto.json"
//	      }
//	    }
//	  ]
//	}
//
// Declared AFTER any fetch-bsr step that writes into the same tree: extract
// steps run in list order, so a fetch declared first has already written its
// protos and its lock by the time this reads them.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor: the things a .proto does
// not say about the estate it belongs to.
type Options struct {
	Context string `json:"context"`
	Service string `json:"service"`

	// Paths are directories of protos this service PUBLISHES, relative to the
	// input root. They become what it provides.
	Paths []string `json:"paths,omitempty"`

	// Vendored are directories of client copies this service CONSUMES. They
	// become what it calls.
	//
	// An explicit list rather than a glob: which copies a service is allowed to
	// keep is an architectural boundary, and a boundary spelled out in the
	// manifest is one a reviewer can see change.
	Vendored []string `json:"vendored,omitempty"`

	// Peers maps a proto package to the service id that answers on it.
	//
	// The only way a consumer-side extractor can name a peer. Without an entry
	// the call keeps the raw package name, which is exactly what `RpcCall.peer`
	// documents - guessing a service id from a package would be inventing an
	// edge between two services.
	Peers map[string]string `json:"peers,omitempty"`

	// Modules maps a directory, relative to the input root, to the module id
	// its protos belong to. Only needed where there is no lock file to say.
	Modules map[string]string `json:"modules,omitempty"`

	// Defs is "shared" (the default) or "off". Shared promotes a message the
	// author put in another file to a catalog.defs entry, on the reasoning that
	// an import is their own signal the type is not local.
	Defs string `json:"defs,omitempty"`

	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-proto:", err)
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
