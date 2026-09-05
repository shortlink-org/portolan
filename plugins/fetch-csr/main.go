// Package main is portolan-fetch-csr: a Confluent Schema Registry on one side,
// schema files committed to this repository on the other.
//
// It is the second plugin here that opens a socket, and it is split from
// portolan-extract-csr for the reason portolan-fetch-bsr is split from
// portolan-extract-proto. Extraction stays a pure function of the tree;
// fetching is the step that can fail, need a credential, or come back with
// something different than it did yesterday. Keeping them apart is what lets
// CI verify an estate whose schemas live in a registry it never talks to.
//
// The fetched schemas are the plugin's Response.Files, not a side effect. The
// host writes them, so they get a manifest entry, are compared by `gen:check`
// like any other generated file, and are removed when the step stops naming
// them. Refreshing a pin then produces ONE pull request holding the version
// bump, the schema diff, the lock diff and the fragment diff - which is the
// review worth having, and the one a registry UI cannot give you.
//
// A registered version is immutable: subject `orders-value` at version 3 is
// the same bytes today and next year, and re-registering a changed schema
// makes version 4. That is the same promise a BSR commit makes, and it is the
// only reason replaying from disk is equivalent to fetching again. So a
// subject is PINNED to a version here, exactly as a module is pinned to a
// commit there.
//
// The shape of the two steps, fetch and then read:
//
//	{
//	  "plugins": [
//	    { "name": "csr",         "process": { "command": "go", "args": ["run", "./plugins/fetch-csr"] } },
//	    { "name": "csr-schemas", "process": { "command": "go", "args": ["run", "./plugins/extract-csr"] } }
//	  ],
//	  "extract": [
//	    {
//	      "plugin": "csr",
//	      "in": "examples/shop/oms",
//	      "out": "examples/shop/oms/vendor/schemas",
//	      "options": {
//	        "registry": "https://psrc-00000.eu-central-1.aws.confluent.cloud",
//	        "cache": "examples/shop/oms/vendor/schemas",
//	        "subjects": [{ "subject": "shop.oms.order-value", "version": 3 }]
//	      }
//	    },
//	    {
//	      "plugin": "csr-schemas",
//	      "in": "examples/shop/oms",
//	      "out": "examples/shop/oms/portolan",
//	      "options": {
//	        "context": "shop",
//	        "service": "oms",
//	        "paths": ["vendor/schemas"],
//	        "out": "schemas.json"
//	      }
//	    }
//	  ]
//	}
//
// The csr step is declared FIRST: extract steps run in list order, so its
// schemas and locks are on disk by the time the reader looks for them.
//
// In CI, set PORTOLAN_OFFLINE=1. The step then replays the committed copies,
// checks them against their locks and emits an identical file list, so a
// fork's pull request needs no secret and the registry being down cannot turn
// the tree red.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the fetcher.
//
// No credential, ever. portolan.json is committed; the API key comes from the
// environment, and only auth.go looks at it. The registry URL is not a
// credential - it is a fact about the estate, the same kind of fact as a
// module's registry-global name - so it is written down here.
type Options struct {
	// Registry is the base URL of the schema registry, without a trailing
	// path: "https://psrc-00000.eu-central-1.aws.confluent.cloud", or
	// "http://localhost:8081" for one running beside the tests.
	Registry string `json:"registry"`

	Subjects []Subject `json:"subjects"`

	// Cache is where the last run's files were written, repo-relative, and
	// should be the same path as the step's `out`.
	//
	// Stated twice because a plugin is never told where its output goes. That
	// is the whole shape of the protocol - a plugin returns files and the host
	// decides what to do with them - and not an oversight to work around.
	Cache string `json:"cache"`
}

// Subject is one pinned registration.
type Subject struct {
	// Subject is the registry's own name for it: "shop.oms.order-value" under
	// TopicNameStrategy, "shop.oms.OrderPlaced" under RecordNameStrategy.
	Subject string `json:"subject"`

	// Version pins it. A registered version is immutable, so a pinned
	// download is byte-reproducible - which is the only reason replaying from
	// disk is equivalent to fetching again. Leaving it out resolves `latest`
	// and is warned about; offline it is refused, because there is nothing to
	// replay against.
	Version int `json:"version,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-fetch-csr:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(_ plugin.Request, opts Options) (plugin.Response, error) {
		return fetch(opts)
	})
}
