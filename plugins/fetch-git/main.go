// Package main is portolan-fetch-git: a git repository on one side, a narrowed
// copy of it committed to this repository on the other.
//
// It exists for the estate whose services live in repositories of their own.
// An extractor reads one tree, and reads it as a pure function of what is on
// disk; fetching is the step that can fail, need a credential, or come back
// with something different than it did yesterday. Keeping the two apart is
// what lets CI verify an estate it never clones.
//
// The fetched files are the plugin's Response.Files, not a side effect. The
// host writes them, so they get a manifest entry, are compared by `gen:check`
// like any other generated file, and are removed when the step stops naming
// them. Paths inside the copy are the repository's own, so the extract step
// that follows points its `in` at the vendored service and reads it exactly
// as it would read the service's own checkout. Refreshing a pin then produces
// ONE pull request holding the pin bump, the source diff, the lock diff and
// the fragment diff - which is the review worth having.
//
// Two files land beside each copy. `git.lock.json` is for the next run of this
// step - the commit and every file's digest, which is what makes replaying it
// equivalent to fetching again. `git.repo.json` is for the estate: a catalog
// fragment naming the repository and the commit, which is the only way that
// fact reaches a page. Nothing downstream can work it out - a service says
// which repository it lives in, and an extractor reads a directory as a pure
// function of what is on disk - so without it a vendored service's source
// paths are text nobody can open. It has to be matched by `sources` in the
// manifest, and by SOURCE_GLOBS in src/data.ts, to be read.
//
// It is not wired into portolan.json until there is a second repository. The
// manifest it expects:
//
//	{
//	  "sources": ["data/*.json", "vendor/repos/*/*/git.repo.json"],
//	  "plugins": [
//	    { "name": "git", "process": { "command": "go", "args": ["run", "./plugins/fetch-git"] } }
//	  ],
//	  "extract": [
//	    {
//	      "plugin": "git",
//	      "in": "vendor",
//	      "out": "vendor/repos",
//	      "options": {
//	        "cache": "vendor/repos",
//	        "repos": [
//	          {
//	            "repo": "github.com/acme/shop",
//	            "commit": "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0",
//	            "paths": ["services/oms", "proto"]
//	          }
//	        ]
//	      }
//	    },
//	    {
//	      "plugin": "go-domain",
//	      "in": "vendor/repos/acme/shop/services/oms",
//	      "out": "data/shop",
//	      "options": { "context": "shop", "service": "oms", "store": "pg" }
//	    }
//	  ]
//	}
//
// The git step is declared FIRST: extract steps run in list order, so the copy
// and its lock are on disk by the time the extractors read them.
//
// In CI, set PORTOLAN_OFFLINE=1. The step then replays the committed copies,
// checks them against their locks and emits an identical file list, so a fork's
// pull request needs no credential and a forge being down cannot turn the tree
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
// No credential, ever. portolan.json is committed; git reaches the forge with
// whatever it is configured with - a credential helper, a netrc entry, an ssh
// agent - and this plugin reads none of it.
type Options struct {
	Repos []Repo `json:"repos"`

	// Cache is where the last run's files were written, repo-relative, and
	// should be the same path as the step's `out`.
	//
	// Stated twice because a plugin is never told where its output goes. That
	// is the whole shape of the protocol - a plugin returns files and the host
	// decides what to do with them - and not an oversight to work around.
	Cache string `json:"cache"`
}

type Repo struct {
	// Repo is where the repository is: "github.com/acme/shop", or any URL git
	// accepts - https://, ssh://, git@host:owner/name.
	Repo string `json:"repo"`

	// Commit pins it. A commit is immutable, so a pinned fetch is
	// byte-reproducible - which is the only reason replaying from disk is
	// equivalent to fetching again. Leaving it out is allowed and warned about;
	// offline it is refused, because there is nothing to replay against.
	Commit string `json:"commit,omitempty"`

	// Ref is the branch or tag to resolve when there is no commit. Defaults to
	// the remote's HEAD.
	Ref string `json:"ref,omitempty"`

	// Paths narrows the copy to the directories actually read, which is how a
	// vendored repository stays small. Left out, the whole tree.
	Paths []string `json:"paths,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-fetch-git:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(_ plugin.Request, opts Options) (plugin.Response, error) {
		return fetch(opts)
	})
}
