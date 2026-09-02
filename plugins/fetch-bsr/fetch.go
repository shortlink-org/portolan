package main

// Deciding whether to fetch, and what to do when the fetch cannot happen.
//
// The rules below are the design, not error handling. The one that matters
// most is the third: a failed fetch with no cache is a NON-ZERO EXIT, never a
// short file list. The host deletes files a step stops naming, and dropping a
// repository's vendored protos because a laptop went offline is worse than a
// red build.

import (
	"encoding/json"
	"fmt"
	"path"
	"path/filepath"
	"sort"

	"github.com/shortlink-org/portolan/plugin"
)

func jsonUnmarshal(raw []byte, into any) error { return json.Unmarshal(raw, into) }

// fetch takes no plugin.Input: it reads nothing out of the tree being
// described. Its `cache` is repo-relative, like every other path in the
// manifest, and everything else it needs is in the options.
func fetch(opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}

	if len(opts.Modules) == 0 {
		return plugin.Response{}, fmt.Errorf("no modules to fetch: name at least one in the manifest")
	}
	if opts.Cache == "" {
		return plugin.Response{}, fmt.Errorf(
			"no cache directory: set `cache` to the same path as the step's `out`, " +
				"so an offline run can replay what the last online one wrote")
	}

	// Sorted, so the file list and the diagnostics come out the same way every
	// run whatever order the manifest happens to list them in.
	wanted := append([]Module(nil), opts.Modules...)
	sort.Slice(wanted, func(i, j int) bool { return wanted[i].Module < wanted[j].Module })

	skip := offline()

	for _, want := range wanted {
		registry, owner, module, err := splitModule(want.Module)
		if err != nil {
			return plugin.Response{}, err
		}
		if opts.Registry != "" {
			registry = opts.Registry
		}

		// Every module lives in its own directory with its own lock, so a
		// vendored module is self-describing and extract-proto finds the lock
		// by looking beside the files it is already reading.
		dir := path.Join(owner, module)
		at := filepath.Join(filepath.FromSlash(opts.Cache), filepath.FromSlash(dir))

		if skip {
			if err := emitCached(b, dir, at, want, "offline"); err != nil {
				return plugin.Response{}, err
			}

			continue
		}

		commit, files, err := live(registry, owner, module, want, b)
		if err != nil {
			// Rule 2: the tree still holds a good copy, so the output is
			// unchanged and `--check` stays clean.
			if cacheErr := emitCached(b, dir, at, want, err.Error()); cacheErr != nil {
				// Rule 3: nothing to fall back to.
				return plugin.Response{}, fmt.Errorf(
					"%s could not be fetched (%w) and there is no usable copy in the tree (%v)",
					want.Module, err, cacheErr)
			}

			continue
		}

		if err := emitFetched(b, dir, want.Module, commit, files); err != nil {
			return plugin.Response{}, err
		}
	}

	return b.Response(), nil
}

// live fetches one module, pinning it first if the manifest did not.
func live(registry, owner, module string, want Module, b *plugin.Builder) (wireCommit, map[string][]byte, error) {
	c := newClient(registry, token(registry))

	ref := want.Commit
	if ref == "" {
		// Rule: pin, or every run is a lottery. Resolving a label still works,
		// but it is said out loud, because two runs a day apart would then
		// produce two different trees from one manifest.
		ref = firstNonEmpty(want.Ref, "main")
		resolved, err := c.resolve(owner, module, ref)
		if err != nil {
			return wireCommit{}, nil, err
		}
		b.Warn(want.Module, fmt.Sprintf(
			"is not pinned; %q resolved to %s. Pin it in portolan.json or every run is a lottery.",
			ref, resolved.ID))
		ref = resolved.ID
	}

	commit, files, err := c.download(owner, module, ref, want.Paths)
	if err != nil {
		return wireCommit{}, nil, err
	}
	if len(files) == 0 {
		return wireCommit{}, nil, fmt.Errorf("%s at %s holds no .proto files", want.Module, ref)
	}

	return commit, files, nil
}

// emitFetched writes what came back, plus the lock that makes it checkable.
func emitFetched(b *plugin.Builder, dir, name string, commit wireCommit, files map[string][]byte) error {
	entry := LockModule{Module: name, Commit: commit.ID, Digest: commit.display()}

	paths := make([]string, 0, len(files))
	for at := range files {
		paths = append(paths, at)
	}
	sort.Strings(paths)

	for _, at := range paths {
		content := files[at]
		b.File(path.Join(dir, at), string(content))
		entry.Files = append(entry.Files, LockEntry{
			Path:   at,
			SHA256: digestOf(content),
			Size:   len(content),
		})
	}

	lock, err := Lock{Modules: []LockModule{entry}}.encode()
	if err != nil {
		return err
	}
	b.File(path.Join(dir, LockName), lock)

	return nil
}

// emitCached re-emits the committed copy unchanged.
//
// Byte-identical to what the last online run wrote, which is the whole point:
// `gen:check` sees no drift, so CI can verify an estate whose schemas live in a
// registry it never talks to.
func emitCached(b *plugin.Builder, dir, at string, want Module, why string) error {
	if want.Commit == "" {
		return fmt.Errorf("%s is not pinned to a commit, so there is nothing to replay", want.Module)
	}

	held, err := replay(at)
	if err != nil {
		return err
	}
	if held.lock.Commit != want.Commit {
		return fmt.Errorf("%s holds commit %s but the manifest pins %s; fetch it",
			want.Module, held.lock.Commit, want.Commit)
	}

	for _, entry := range held.lock.Files {
		b.File(path.Join(dir, entry.Path), string(held.files[entry.Path]))
	}

	lock, err := Lock{Modules: []LockModule{held.lock}}.encode()
	if err != nil {
		return err
	}
	b.File(path.Join(dir, LockName), lock)

	b.Warn(want.Module, "not fetched ("+why+"); the copy committed in this repository is used unchanged")

	return nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}

	return ""
}
