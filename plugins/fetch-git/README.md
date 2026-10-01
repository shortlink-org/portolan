# fetch-git

A git repository on one side, a text snapshot of it committed to this
repository on the other, so that extractors can read services that live
elsewhere. The implementation is `scripts/host-plugins/fetch-git.mjs`: it
runs inside the host because it needs a socket and a git binary, which no
sandboxed module has (portolan.0008). This directory holds nothing tracked
beyond this file; a binary here is a build leftover ignored by git.

## What it reads

Nothing out of the tree being described. Each entry of `repos` names a
repository - `github.com/acme/shop`, or any URL git accepts (`https://`,
`ssh://`, `git@host:owner/name`) - pinned to a `commit`, optionally narrowed
to `paths`. One commit is fetched into a temporary directory (`git fetch
--depth 1`, by commit where the forge allows and by branches where it does
not), verified to be that commit, and its blobs read with one `git cat-file
--batch`. Known binary extensions and anything with a NUL byte or invalid
UTF-8 in its first 8 KiB are skipped and recorded.

Without a `commit`, `ref` (default HEAD) is resolved with `git ls-remote`
and warned about: an unpinned fetch makes every run a lottery. In CI, or
with `PORTOLAN_OFFLINE=1`, no socket is opened: the copy in `cache` is read
back, checked against its lock - same commit, same paths, every file's
digest - and re-emitted byte for byte. A fetch that fails with a good copy
in the tree falls back to it with a warning; a failure with nothing to fall
back on is an error, never a shorter file list.

No credential, ever: git reaches the forge with whatever it is configured
with, and nothing here reads or passes any of it.

## What it emits

Under `<out>/<owner>/<name>/`: every text file of the commit at its own
repository-relative path, so the extract step that follows points its `in`
at the copy and reads it as it would the service's checkout; `git.lock.json`
(repo, commit, paths, each file's path, sha256 and size, and the skipped
binaries); and `git.repo.json`, a catalog fragment whose `repos` entry names
the repository as `host/owner/name`, the commit, and where the copy sits.
That pin is how the fact reaches a page and how the host tells a plugin which
repository its `in` belongs to (`input.repository`).

## Options

`repos` (each with `repo`, `commit`, `ref`, `paths`) and `cache`, both
required. `cache` is the same path as the step's `out`. See
`scripts/host-plugins/fetch-git.options.json`.

## Manifest

```json
{
  "plugins": [{ "name": "git", "host": "fetch-git" }],
  "extract": [
    { "plugin": "git", "in": ".", "out": "vendor/repos",
      "options": { "cache": "vendor/repos",
                   "repos": [{ "repo": "github.com/acme/shop", "commit": "0123456789abcdef0123456789abcdef01234567", "paths": ["services/payments"] }] } },
    { "plugin": "go-domain", "in": "vendor/repos/acme/shop/services/payments", "out": "vendor/repos/acme/shop/services/payments/portolan",
      "options": { "context": "payments", "service": "payments" } }
  ]
}
```

The site's Plugins → Git → Settings page edits this step
(`docs/git-fetch-settings.md`).

## Runtime

Node, inside the host process, with a `git` binary on the path and
`GIT_TERMINAL_PROMPT=0`. A checkout on this machine can answer for a
repository instead of the forge (portolan.0029); that is the host's to
arrange, never the manifest's.

## Limits

- Binary files are never emitted; their metadata is kept in the lock.
- A vendored copy edited by hand fails the offline replay: its bytes no
  longer match their digest.
- The snapshot is not a git checkout; anything needing `.git` history reads
  the real repository.

## Tests

`npx vitest run scripts/host-plugins/fetch-git.test.mjs`, against a local
bare repository.
