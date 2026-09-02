package main

// Where a set of .proto files came from.
//
// Two answers are possible and both are honest. A directory written into by
// `fetch-bsr` has a `bsr.lock.json` beside it saying which module and which
// commit; a directory of protos the estate simply keeps has neither, and gets a
// `local:` id so nobody mistakes the path for something they could go and
// fetch.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// lockFile is the shape fetch-bsr writes. Read here rather than shared, because
// the two plugins are separate programs on purpose: one may run without the
// other ever having existed.
type lockFile struct {
	Modules []lockModule `json:"modules"`
}

type lockModule struct {
	Module string      `json:"module"`
	Commit string      `json:"commit"`
	Digest string      `json:"digest"`
	Deps   []string    `json:"deps,omitempty"`
	Files  []lockEntry `json:"files"`
}

type lockEntry struct {
	Path string `json:"path"`
}

const lockName = "bsr.lock.json"

// readLock loads the lock beside a directory of protos, if there is one.
func readLock(dir string) (*lockFile, error) {
	raw, err := os.ReadFile(filepath.Join(dir, lockName))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var lock lockFile
	if err := json.Unmarshal(raw, &lock); err != nil {
		return nil, err
	}

	return &lock, nil
}

// moduleFor describes the set of protos under one directory.
//
// packages and files come from what was actually parsed rather than from the
// lock, because the lock says what was fetched and this says what portolan
// could read - and when they disagree, the second is the one a reader needs.
func moduleFor(id, dir string, files []*File) catalog.ProtoModule {
	packages := map[string]bool{}
	paths := make([]string, 0, len(files))
	for _, file := range files {
		if file.Package != "" {
			packages[file.Package] = true
		}
		paths = append(paths, relativeTo(dir, file.Path))
	}

	module := catalog.ProtoModule{
		ID:       id,
		Slug:     moduleSlug(id),
		Name:     moduleName(id),
		Registry: registryOf(id),
		Packages: sortedKeys(packages),
		Files:    sortedCopy(paths),
		Source:   filepath.ToSlash(dir),
	}

	return module
}

func relativeTo(dir, path string) string {
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return filepath.ToSlash(path)
	}

	return filepath.ToSlash(rel)
}

// sortedKeys and sortedCopy exist because the fragment is committed and
// compared by `gen:check`. A map iterated in Go's order writes a different file
// every run, which would turn every build into a diff.
func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)

	return out
}

func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)

	return out
}

// trimSlash keeps a directory option comparable however it was written.
func trimSlash(dir string) string {
	return strings.TrimSuffix(filepath.ToSlash(dir), "/")
}
