package main

// Deciding whether to fetch, and what to do when the fetch cannot happen.
//
// The rules below are the design, not error handling, and they are the rules
// fetch-bsr lives by. The one that matters most is the third: a failed fetch
// with no cache is a NON-ZERO EXIT, never a short file list. The host deletes
// files a step stops naming, and dropping a vendored service because a laptop
// went offline is worse than a red build.

import (
	"fmt"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/plugin"
)

// fetch reads nothing out of the tree being described. Its `cache` is
// repo-relative, like every other path in the manifest, and everything else
// it needs is in the options.
func fetch(opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}

	if len(opts.Repos) == 0 {
		return plugin.Response{}, fmt.Errorf("no repositories to fetch: name at least one in the manifest")
	}
	if opts.Cache == "" {
		return plugin.Response{}, fmt.Errorf(
			"no cache directory: set `cache` to the same path as the step's `out`, " +
				"so an offline run can replay what the last online one wrote")
	}

	// Sorted, so the file list and the diagnostics come out the same way every
	// run whatever order the manifest happens to list them in.
	wanted := append([]Repo(nil), opts.Repos...)
	sort.Slice(wanted, func(i, j int) bool { return wanted[i].Repo < wanted[j].Repo })

	skip := offline()

	for _, want := range wanted {
		url, dir, err := splitRepo(want.Repo)
		if err != nil {
			return plugin.Response{}, err
		}
		at := filepath.Join(filepath.FromSlash(opts.Cache), filepath.FromSlash(dir))

		if skip {
			if err := emitCached(b, dir, at, want, "offline"); err != nil {
				return plugin.Response{}, err
			}

			continue
		}

		commit, files, err := live(url, want, b)
		if err != nil {
			// Rule 2: the tree still holds a good copy, so the output is
			// unchanged and `--check` stays clean.
			if cacheErr := emitCached(b, dir, at, want, err.Error()); cacheErr != nil {
				// Rule 3: nothing to fall back to.
				return plugin.Response{}, fmt.Errorf(
					"%s could not be fetched (%w) and there is no usable copy in the tree (%v)",
					want.Repo, err, cacheErr)
			}

			continue
		}

		if err := emitFetched(b, dir, want, commit, files); err != nil {
			return plugin.Response{}, err
		}
	}

	return b.Response(), nil
}

// live fetches one repository, pinning it first if the manifest did not.
func live(url string, want Repo, b *plugin.Builder) (string, map[string][]byte, error) {
	commit := want.Commit
	if commit == "" {
		// Rule: pin, or every run is a lottery. Resolving a ref still works,
		// but it is said out loud, because two runs a day apart would then
		// produce two different trees from one manifest.
		resolved, err := resolve(url, want.Ref)
		if err != nil {
			return "", nil, err
		}
		b.Warn(want.Repo, fmt.Sprintf(
			"is not pinned; %q resolved to %s. Pin it in portolan.json or every run is a lottery.",
			firstNonEmpty(want.Ref, "HEAD"), resolved))
		commit = resolved
	}

	files, err := download(url, commit, want.Paths)
	if err != nil {
		return "", nil, err
	}
	if len(files) == 0 {
		return "", nil, fmt.Errorf("%s at %s holds no files under %s", want.Repo, commit, strings.Join(want.Paths, ", "))
	}

	return commit, files, nil
}

// emitFetched writes what came back, plus the lock that makes it checkable.
func emitFetched(b *plugin.Builder, dir string, want Repo, commit string, files map[string][]byte) error {
	entry := LockRepo{Repo: want.Repo, Commit: commit, Paths: append([]string(nil), want.Paths...)}

	paths := make([]string, 0, len(files))
	for at := range files {
		paths = append(paths, at)
	}
	sort.Strings(paths)

	for _, at := range paths {
		content := files[at]
		b.File(path.Join(dir, at), string(content))
		entry.Files = append(entry.Files, LockEntry{Path: at, SHA256: digestOf(content), Size: len(content)})
	}

	lock, err := Lock{Repos: []LockRepo{entry}}.encode()
	if err != nil {
		return err
	}
	b.File(path.Join(dir, LockName), lock)

	return emitPin(b, dir, want.Repo, commit)
}

// emitCached re-emits the committed copy unchanged.
//
// Byte-identical to what the last online run wrote, which is the whole point:
// `gen:check` sees no drift, so CI can verify an estate whose services live in
// repositories it never clones.
func emitCached(b *plugin.Builder, dir, at string, want Repo, why string) error {
	if want.Commit == "" {
		return fmt.Errorf("%s is not pinned to a commit, so there is nothing to replay", want.Repo)
	}

	held, err := replay(at)
	if err != nil {
		return err
	}
	if held.lock.Commit != want.Commit {
		return fmt.Errorf("%s holds commit %s but the manifest pins %s; fetch it", want.Repo, held.lock.Commit, want.Commit)
	}

	for _, entry := range held.lock.Files {
		b.File(path.Join(dir, entry.Path), string(held.files[entry.Path]))
	}

	lock, err := Lock{Repos: []LockRepo{held.lock}}.encode()
	if err != nil {
		return err
	}
	b.File(path.Join(dir, LockName), lock)

	// From the LOCK's commit, not the manifest's. They are equal by the check
	// above, and taking it from the copy is what keeps the fragment describing
	// what is actually on disk rather than what was asked for.
	if err := emitPin(b, dir, want.Repo, held.lock.Commit); err != nil {
		return err
	}

	b.Warn(want.Repo, "not fetched ("+why+"); the copy committed in this repository is used unchanged")

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
