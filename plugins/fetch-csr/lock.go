package main

// What was fetched, so it can be checked without fetching again.
//
// One lock per subject directory rather than one for the whole step, so a
// vendored subject is self-describing: the schema, the registry it came from,
// the version it was pinned to and the subjects it references sit together,
// and the reader finds the lock by looking beside the file it is already
// reading.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// LockName is the file written beside each subject's schema.
const LockName = "csr.lock.json"

type Lock struct {
	// Registry is where these bytes came from. A module's registry-global name
	// carries its registry; a subject's name does not, so it is written down
	// here or the vendored copy cannot say where it belongs.
	Registry string `json:"registry"`

	Subjects []LockSubject `json:"subjects"`
}

type LockSubject struct {
	Subject string `json:"subject"`

	// Version is what was actually fetched. A registered version is immutable,
	// so a pinned download is byte-reproducible and this is what makes
	// replaying from disk equivalent to fetching again.
	Version int `json:"version"`

	// ID is the registry-global schema id, and GUID the wider identifier for
	// the same schema. Neither is needed to replay; both are what a message on
	// the wire actually carries, so an incident that has a schema id and
	// nothing else can be traced back to this file.
	ID   int    `json:"id"`
	GUID string `json:"guid,omitempty"`

	SchemaType string `json:"schemaType"`

	// References are the subjects this schema depends on, pinned by the schema
	// itself. Each is fetched into its own directory, so this list is also how
	// an offline replay knows what else to read.
	References []Reference `json:"references,omitempty"`

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
//
// References are sorted too. The registry answers them in registration order,
// which is stable for a pinned version, but they are a lookup from name to
// subject rather than a sequence, and sorting says so.
func (l Lock) encode() (string, error) {
	for i := range l.Subjects {
		sort.Slice(l.Subjects[i].Files, func(a, b int) bool {
			return l.Subjects[i].Files[a].Path < l.Subjects[i].Files[b].Path
		})
		sort.Slice(l.Subjects[i].References, func(a, b int) bool {
			return l.Subjects[i].References[a].Name < l.Subjects[i].References[b].Name
		})
	}
	sort.Slice(l.Subjects, func(a, b int) bool { return l.Subjects[a].Subject < l.Subjects[b].Subject })

	out, err := json.MarshalIndent(l, "", "  ")
	if err != nil {
		return "", err
	}

	return string(out) + "\n", nil
}
