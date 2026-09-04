package main

// What was fetched, so it can be checked without fetching again.
//
// One lock per repository directory rather than one for the whole step, so a
// vendored copy is self-describing: the files and the statement of where they
// came from sit together.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// LockName is the file written beside each repository's copy.
const LockName = "git.lock.json"

type Lock struct {
	Repos []LockRepo `json:"repos"`
}

type LockRepo struct {
	Repo string `json:"repo"`

	// Commit is what was actually fetched. A commit is immutable, so a pinned
	// fetch is byte-reproducible and this is what makes replaying from disk
	// equivalent to fetching again.
	Commit string `json:"commit"`

	// Paths is the narrowing the copy was made with, so a wider or narrower
	// manifest is a change to the copy rather than a mystery.
	Paths []string `json:"paths,omitempty"`

	Files []LockEntry `json:"files"`
}

type LockEntry struct {
	Path string `json:"path"`

	// SHA256 is over the bytes as written. It is what turns a cache into
	// something checkable: a vendored copy someone edited by hand stops
	// matching, which is exactly the drift docs/adr/org.0001.md wants visible.
	SHA256 string `json:"sha256"`
	Size   int    `json:"size"`
}

func digestOf(content []byte) string {
	sum := sha256.Sum256(content)

	return hex.EncodeToString(sum[:])
}

// encode writes the lock the way every generated file in this repository is
// written: sorted, indented, newline-terminated. It is committed and compared
// by `gen:check`, so an unstable order would rewrite it on every run.
func (l Lock) encode() (string, error) {
	for i := range l.Repos {
		sort.Slice(l.Repos[i].Files, func(a, b int) bool {
			return l.Repos[i].Files[a].Path < l.Repos[i].Files[b].Path
		})
		sort.Strings(l.Repos[i].Paths)
	}
	sort.Slice(l.Repos, func(a, b int) bool { return l.Repos[a].Repo < l.Repos[b].Repo })

	out, err := json.MarshalIndent(l, "", "  ")
	if err != nil {
		return "", err
	}

	return string(out) + "\n", nil
}
