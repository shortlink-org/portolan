package main

// Replaying a fetch from what is already on disk.
//
// The cache is not a second copy of anything: it IS the tree. The protos this
// plugin fetched were written by the host through the ordinary Response.Files
// path, so they are committed, reviewable, and GC'd when the step stops naming
// them. Reading them back and checking them against the lock is what lets a
// build that never opens a socket produce byte-identical output.

import (
	"fmt"
	"os"
	"path/filepath"
)

// cached is one module's files, read back from the tree.
type cached struct {
	lock  LockModule
	files map[string][]byte
}

// replay reads a module's committed copy and checks it against its lock.
//
// An incomplete or edited cache is reported rather than patched over. The two
// failures it distinguishes matter: nothing on disk means there is nothing to
// fall back to, and bytes that no longer match their digest mean somebody
// edited a vendored copy - the drift docs/adr/org.0001.md wants visible.
func replay(dir string) (*cached, error) {
	raw, err := os.ReadFile(filepath.Join(dir, LockName))
	if os.IsNotExist(err) {
		return nil, fmt.Errorf("no %s in %s", LockName, filepath.ToSlash(dir))
	}
	if err != nil {
		return nil, err
	}

	var lock Lock
	if err := jsonUnmarshal(raw, &lock); err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.ToSlash(filepath.Join(dir, LockName)), err)
	}
	if len(lock.Modules) != 1 {
		return nil, fmt.Errorf("%s names %d modules; expected exactly one",
			filepath.ToSlash(filepath.Join(dir, LockName)), len(lock.Modules))
	}

	entry := lock.Modules[0]
	files := make(map[string][]byte, len(entry.Files))

	for _, want := range entry.Files {
		at := filepath.Join(dir, filepath.FromSlash(want.Path))
		content, err := os.ReadFile(at)
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%s is in the lock but not on disk", want.Path)
		}
		if err != nil {
			return nil, err
		}
		if got := digestOf(content); got != want.SHA256 {
			return nil, fmt.Errorf("%s does not match its digest; the vendored copy was edited by hand", want.Path)
		}
		files[want.Path] = content
	}

	return &cached{lock: entry, files: files}, nil
}
