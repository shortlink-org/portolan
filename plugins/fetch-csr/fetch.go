package main

// Deciding whether to fetch, and what to do when the fetch cannot happen.
//
// The rules below are the design, not error handling. The one that matters
// most is the third: a failed fetch with no cache is a NON-ZERO EXIT, never a
// short file list. The host deletes files a step stops naming, and dropping a
// repository's vendored schemas because a laptop went offline is worse than a
// red build.

import (
	"fmt"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/plugin"
)

// fetch takes no plugin.Input: it reads nothing out of the tree being
// described. Its `cache` is repo-relative, like every other path in the
// manifest, and everything else it needs is in the options.
func fetch(opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}

	if strings.TrimSpace(opts.Registry) == "" {
		return plugin.Response{}, fmt.Errorf("no registry: name the schema registry's base URL in the manifest")
	}
	if len(opts.Subjects) == 0 {
		return plugin.Response{}, fmt.Errorf("no subjects to fetch: name at least one in the manifest")
	}
	if opts.Cache == "" {
		return plugin.Response{}, fmt.Errorf(
			"no cache directory: set `cache` to the same path as the step's `out`, " +
				"so an offline run can replay what the last online one wrote")
	}

	// Sorted, so the file list and the diagnostics come out the same way every
	// run whatever order the manifest happens to list them in.
	queue := append([]Subject(nil), opts.Subjects...)
	sort.Slice(queue, func(i, j int) bool { return queue[i].Subject < queue[j].Subject })

	c := newClient(opts.Registry, authorization())
	skip := offline()

	// Two subjects that slug to the same directory would overwrite each other
	// silently, and one subject wanted at two versions cannot be held in a
	// tree that keeps one version per subject. Both are refused by name rather
	// than resolved: the manifest is what has to change.
	claimed := map[string]Subject{}
	done := map[string]bool{}

	for len(queue) > 0 {
		want := queue[0]
		queue = queue[1:]

		if want.Subject == "" {
			return plugin.Response{}, fmt.Errorf("a subject entry names no subject")
		}
		if held, taken := claimed[want.Subject]; taken {
			if held.Version != want.Version {
				return plugin.Response{}, fmt.Errorf(
					"%s is wanted at version %s and at version %s; the tree keeps one version per subject, so pin one",
					want.Subject, pin(held.Version), pin(want.Version))
			}

			continue
		}

		dir := slugOf(want.Subject)
		if done[dir] {
			// Not caught by `claimed`, which is keyed by subject: two
			// different subjects can slug into one directory.
			return plugin.Response{}, fmt.Errorf(
				"%s and another subject both vendor into %s; the tree cannot hold both",
				want.Subject, dir)
		}
		claimed[want.Subject] = want
		done[dir] = true

		at := filepath.Join(filepath.FromSlash(opts.Cache), filepath.FromSlash(dir))

		var (
			refs []Reference
			err  error
		)

		if skip {
			refs, err = emitCached(b, opts.Registry, dir, at, want, "offline")
			if err != nil {
				return plugin.Response{}, err
			}
		} else if refs, err = live(c, b, opts.Registry, dir, want); err != nil {
			// Rule 2: the tree still holds a good copy, so the output is
			// unchanged and `--check` stays clean.
			cachedRefs, cacheErr := emitCached(b, opts.Registry, dir, at, want, err.Error())
			if cacheErr != nil {
				// Rule 3: nothing to fall back to.
				return plugin.Response{}, fmt.Errorf(
					"%s could not be fetched (%w) and there is no usable copy in the tree (%v)",
					want.Subject, err, cacheErr)
			}
			refs = cachedRefs
		}

		// A referenced subject is pinned by the schema that references it, so
		// following one needs no permission from the manifest and adds no
		// lottery: the version is part of the bytes we already have.
		following := make([]Subject, 0, len(refs))
		for _, ref := range refs {
			if ref.Subject == "" || claimed[ref.Subject].Subject != "" {
				continue
			}
			following = append(following, Subject{Subject: ref.Subject, Version: ref.Version})
		}
		sort.Slice(following, func(i, j int) bool { return following[i].Subject < following[j].Subject })
		queue = append(queue, following...)
	}

	return b.Response(), nil
}

// live fetches one subject, pinning it first if the manifest did not.
func live(c *client, b *plugin.Builder, registry, dir string, want Subject) ([]Reference, error) {
	got, err := c.version(want.Subject, want.Version)
	if err != nil {
		return nil, err
	}

	if want.Version == 0 {
		// Rule: pin, or every run is a lottery. Resolving `latest` still
		// works, but it is said out loud, because two runs a day apart would
		// then produce two different trees from one manifest.
		b.Warn(want.Subject, fmt.Sprintf(
			"is not pinned; \"latest\" resolved to version %d. Pin it in portolan.json or every run is a lottery.",
			got.Version))
	}

	extension, err := extensionFor(got.SchemaType)
	if err != nil {
		return nil, fmt.Errorf("%s at version %d: %w", want.Subject, got.Version, err)
	}

	name := "v" + strconv.Itoa(got.Version) + extension
	content := body(got.SchemaType, got.Schema)

	entry := LockSubject{
		Subject:    want.Subject,
		Version:    got.Version,
		ID:         got.ID,
		GUID:       got.GUID,
		SchemaType: schemaType(got.SchemaType),
		References: got.References,
		Files: []LockEntry{{
			Path:   name,
			SHA256: digestOf([]byte(content)),
			Size:   len(content),
		}},
	}

	b.File(path.Join(dir, name), content)
	if err := emitLock(b, registry, dir, entry); err != nil {
		return nil, err
	}

	return entry.References, nil
}

// emitCached re-emits the committed copy unchanged.
//
// Byte-identical to what the last online run wrote, which is the whole point:
// `gen:check` sees no drift, so CI can verify an estate whose schemas live in a
// registry it never talks to.
func emitCached(b *plugin.Builder, registry, dir, at string, want Subject, why string) ([]Reference, error) {
	if want.Version == 0 {
		return nil, fmt.Errorf("%s is not pinned to a version, so there is nothing to replay", want.Subject)
	}

	held, err := replay(at)
	if err != nil {
		return nil, err
	}
	if held.lock.Version != want.Version {
		return nil, fmt.Errorf("%s holds version %d but the manifest pins %d; fetch it",
			want.Subject, held.lock.Version, want.Version)
	}
	if held.lock.Subject != want.Subject {
		return nil, fmt.Errorf("%s vendors into %s, which holds %s",
			want.Subject, filepath.ToSlash(at), held.lock.Subject)
	}
	if held.registry != "" && held.registry != registry {
		return nil, fmt.Errorf("%s was fetched from %s but the manifest names %s; fetch it again",
			want.Subject, held.registry, registry)
	}

	for _, entry := range held.lock.Files {
		b.File(path.Join(dir, entry.Path), string(held.files[entry.Path]))
	}
	if err := emitLock(b, registry, dir, held.lock); err != nil {
		return nil, err
	}

	b.Warn(want.Subject, "not fetched ("+why+"); the copy committed in this repository is used unchanged")

	return held.lock.References, nil
}

func emitLock(b *plugin.Builder, registry, dir string, entry LockSubject) error {
	lock, err := Lock{Registry: registry, Subjects: []LockSubject{entry}}.encode()
	if err != nil {
		return err
	}
	b.File(path.Join(dir, LockName), lock)

	return nil
}

// slugOf is the directory a subject vendors into.
//
// A subject name is whatever the producer registered, and under
// RecordNameStrategy that is a language's full name; a directory is not. So
// everything outside a safe set becomes an underscore, and the true subject is
// written in the lock beside the file rather than inferred back from the path.
func slugOf(subject string) string {
	var out strings.Builder

	for _, r := range subject {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			out.WriteRune(r)
		case r == '.' || r == '-' || r == '_':
			out.WriteRune(r)
		default:
			out.WriteByte('_')
		}
	}

	slug := strings.Trim(out.String(), ".")
	if slug == "" {
		return "_"
	}

	return slug
}

func pin(version int) string {
	if version == 0 {
		return "latest"
	}

	return strconv.Itoa(version)
}
