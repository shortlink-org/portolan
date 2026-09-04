// Package main is portolan-fetch-bsr: a schema registry on one side, .proto
// files committed to this repository on the other.
//
// It is the ONE plugin here that opens a socket, and it is split off from
// portolan-extract-proto for exactly that reason. Extraction stays a pure
// function of the tree; fetching is the step that can fail, need a credential,
// or come back with something different than it did yesterday. Keeping them
// apart is what lets CI verify an estate whose schemas live in a registry it
// never talks to.
//
// The fetched protos are the plugin's Response.Files, not a side effect. The
// host writes them, so they get a manifest entry, are compared by `gen:check`
// like any other generated file, and are removed when the step stops naming
// them. Refreshing a pin then produces ONE pull request holding the pin bump,
// the proto diff, the lock diff and the fragment diff - which is the review
// worth having.
//
// Wired into portolan.json for the order contract oms publishes. The shape of
// the two steps, fetch and then read:
//
//	{
//	  "plugins": [
//	    { "name": "bsr",   "process": { "cmd": "go run ./plugins/fetch-bsr" } },
//	    { "name": "proto", "process": { "cmd": "go run ./plugins/extract-proto" } }
//	  ],
//	  "extract": [
//	    {
//	      "plugin": "bsr",
//	      "in": "examples/shop",
//	      "out": "examples/shop/vendor/proto",
//	      "options": {
//	        "cache": "examples/shop/vendor/proto",
//	        "modules": [
//	          { "module": "buf.build/acme/shop", "commit": "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6" }
//	        ]
//	      }
//	    },
//	    {
//	      "plugin": "proto",
//	      "in": "examples/shop",
//	      "out": "examples/shop/portolan",
//	      "options": {
//	        "context": "shop",
//	        "service": "oms",
//	        "paths": ["vendor/proto/acme/shop"],
//	        "out": "proto.json"
//	      }
//	    }
//	  ]
//	}
//
// The bsr step is declared FIRST: extract steps run in list order, so its
// protos and locks are on disk by the time the proto step reads them.
//
// In CI, set PORTOLAN_OFFLINE=1. The step then replays the committed copies,
// checks them against their locks and emits an identical file list, so a fork's
// pull request needs no secret and the registry being down cannot turn the tree
// red.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the fetcher.
//
// No token, ever. portolan.json is committed; the credential comes from the
// environment, and only auth.go looks at it.
type Options struct {
	Modules []Module `json:"modules"`

	// Registry overrides the host in each module name, for a self-hosted BSR.
	Registry string `json:"registry,omitempty"`

	// Cache is where the last run's files were written, repo-relative, and
	// should be the same path as the step's `out`.
	//
	// Stated twice because a plugin is never told where its output goes. That
	// is the whole shape of the protocol - a plugin returns files and the host
	// decides what to do with them - and not an oversight to work around.
	Cache string `json:"cache"`
}

type Module struct {
	// Module is "<registry>/<owner>/<name>", e.g. "buf.build/acme/shop".
	Module string `json:"module"`

	// Commit pins it. A BSR commit is immutable, so a pinned download is
	// byte-reproducible - which is the only reason replaying from disk is
	// equivalent to fetching again. Leaving it out is allowed and warned about;
	// offline it is refused, because there is nothing to replay against.
	Commit string `json:"commit,omitempty"`

	// Ref is the label to resolve when there is no commit. Defaults to "main".
	Ref string `json:"ref,omitempty"`

	// Paths narrows the download to the directories actually used, which is how
	// a vendored copy stays small.
	Paths []string `json:"paths,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-fetch-bsr:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(_ plugin.Request, opts Options) (plugin.Response, error) {
		return fetch(opts)
	})
}
