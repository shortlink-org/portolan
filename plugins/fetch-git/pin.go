package main

// The fragment that says where the copy came from.
//
// The lock beside it already names the commit, but a lock is a check and not a
// fact anybody reads: nothing loads it, and by the time a page wants to link a
// source line of a vendored service, the only thing left is a repository name
// with no commit against it. So the same answer is written twice, in two
// shapes, for two readers - `git.lock.json` for the next run of this step, and
// a one-line catalog fragment for the estate.
//
// It is a fragment rather than a field the extractor fills in because the
// extractor does not know: it is handed a directory and reads it as a pure
// function of what is on disk, which is the whole reason fetching is a
// separate step. What fetched it knows, so what fetched it says so.

import (
	"encoding/json"
	"path"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// PinName is the fragment written beside each repository's copy. It is named
// after the lock it sits next to, so a directory listing reads as one thing
// the fetch wrote rather than two unrelated files.
const PinName = "git.repo.json"

// webRepo is the repository as `Service.repo` spells it - host/owner/name, the
// way go.mod writes it - whatever spelling the manifest used.
//
// The lock keeps what the manifest said, because a lock is about the fetch. The
// fragment cannot: it is matched against a service's `repo`, and a service read
// out of a Go module has no idea whether whoever vendored it typed an ssh URL.
func webRepo(name string) string {
	name = strings.TrimSpace(name)

	switch {
	case strings.HasPrefix(name, "git@"):
		// git@host:owner/name -> host/owner/name
		host, where, _ := strings.Cut(strings.TrimPrefix(name, "git@"), ":")
		name = host + "/" + where
	case strings.Contains(name, "://"):
		_, name, _ = strings.Cut(name, "://")
		// A URL may carry a user: https://git@host/owner/name.
		if _, after, found := strings.Cut(name, "@"); found {
			name = after
		}
	}

	return strings.TrimSuffix(strings.Trim(name, "/"), ".git")
}

// pin encodes the fragment for one repository at one commit.
//
// The empty lists are not noise: a source is a catalog, and a merge that had to
// tell "no contexts" from "not a catalog" would be reading a shape rather than
// a value. Written the way every generated file in this repository is written,
// so `gen:check` compares it and never rewrites it.
func pin(repo, commit string) (string, error) {
	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{},
		Defs:     map[string]catalog.TypeDef{},
		Flows:    []catalog.Flow{},
		Adrs:     []catalog.Adr{},
		Repos:    []catalog.RepoPin{{Repo: webRepo(repo), Commit: commit}},
	}

	out, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return "", err
	}

	return string(out) + "\n", nil
}

// emitPin writes the fragment into the repository's own directory, beside the
// lock, so a vendored copy stays self-describing: the files, the statement of
// where they came from, and the one fact the catalog needs out of it.
func emitPin(b *plugin.Builder, dir, repo, commit string) error {
	fragment, err := pin(repo, commit)
	if err != nil {
		return err
	}
	b.File(path.Join(dir, PinName), fragment)

	return nil
}
