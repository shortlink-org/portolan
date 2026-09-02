package main

// What was fetched, so it can be checked without fetching again.
//
// One lock per module directory rather than one for the whole step, so a
// vendored module is self-describing: the protos and the statement of where
// they came from sit together, and extract-proto finds the lock by looking
// beside the files it is already reading.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// LockName is the file written beside each module's protos.
const LockName = "bsr.lock.json"

type Lock struct {
	Modules []LockModule `json:"modules"`
}

type LockModule struct {
	Module string `json:"module"`

	// Commit is what was actually fetched. A BSR commit is immutable, so a
	// pinned download is byte-reproducible and this is what makes replaying
	// from disk equivalent to fetching again.
	Commit string `json:"commit"`
	Digest string `json:"digest,omitempty"`

	Deps  []string    `json:"deps,omitempty"`
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
	for i := range l.Modules {
		sort.Slice(l.Modules[i].Files, func(a, b int) bool {
			return l.Modules[i].Files[a].Path < l.Modules[i].Files[b].Path
		})
		sort.Strings(l.Modules[i].Deps)
	}
	sort.Slice(l.Modules, func(a, b int) bool { return l.Modules[a].Module < l.Modules[b].Module })

	out, err := json.MarshalIndent(l, "", "  ")
	if err != nil {
		return "", err
	}

	return string(out) + "\n", nil
}
