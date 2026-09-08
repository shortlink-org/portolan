# portolan.0008 — A plugin that needs a socket runs inside the host

- **Status:** accepted
- **Date:** 2026-09-08
- **Scope:** portolan

## Context and Problem Statement

After portolan.0006 and portolan.0007 every built-in extractor, verifier and
generator runs as one wasm module. What remained as `go run` were the
fetchers: `fetch-git`, which clones another repository at a commit, and
`fetch-bsr`, which talks to a schema registry. Neither reads the tree; both
need what no sandboxed module has, a socket and, for git, a binary. For
those two the package still shipped its Go sources, `go.mod` and the
expectation of a Go toolchain on any machine whose manifest vendors a
service.

A need in the request (portolan.0007) does not fit: history is a value the
host can compute before the step, a fetch is an interaction the step
drives.

## Decision Drivers

- A manifest that vendors from another repository must not require Go.
- The protocol of portolan.0001 stays: files are named, the host writes
  them, `--check` compares, the sweep removes what is no longer named.
- Locks, pins, offline replay and the four fetch rules must not change;
  the committed copies must stay byte-identical.
- A manifest must not be able to point the host at arbitrary code.

## Considered Options

1. **The fetchers become the host's own code**, declared with `host` and
   run in the host process through the same `runPlugin` path.
2. **A `needs: ["network"]` request** answered by the host - a second
   protocol message per request the module wants to make.
3. **Prebuilt native binaries** of the Go fetchers per platform.
4. **A separate npm package** holding the Go fetchers.

## Decision Outcome

Chosen option: **the fetchers become the host's own code**.

A built-in may now be declared as `{ "name": "git", "host": "fetch-git" }`.
The host resolves the name against the modules it ships under
`scripts/host-plugins/` and nothing else, imports the module, and calls it
with the same request any plugin gets; the module answers with named files
and warnings, and the host validates, writes and reports them exactly as it
does for a wasm module. A describe request is answered by the module's own
descriptor, so the manifest schema is composed as before.

`fetch-git`, `fetch-bsr` and `fetch-csr` move this way with the same
options, the same locks and pins, the same offline and CI replay, the same
fallback to the committed copy when the far end is gone, and the same
credentials from the same places. `fetch-git` reads the tree of the fetched
commit with `git ls-tree` and `git cat-file --batch` rather than an archive;
`fetch-csr` re-spaces a schema token by token where Go used `json.Indent`.
Neither changes a byte anyone can see; the vendored module in `examples/`
is re-fetched live and stays identical.

A network need in the request was rejected because a fetch is a
conversation, not a value: resolving a ref, then fetching a commit, then
reading it, with the module deciding each from the last. Native binaries
are the platform matrix portolan.0006 removed. A second package would keep
Go for exactly the users this is for.

### Consequences

- Good: `fetch-git`, `fetch-bsr` and `fetch-csr` all run this way, so no
  `go run` is left in the package and the Go sources, `go.mod` and the Go
  packages stop shipping; Go is needed to build the wasm module, never to
  use it.
- Good: a host plugin is ordinary code in the host's own language, tested
  with the host's tests, with no protocol boundary to cross for what is
  the host's business anyway.
- Bad: a host plugin has everything the host has. It is Portolan's own
  code and is named from a closed list, which is the whole of the
  protection; it is not a place for a plugin from somebody else's
  repository.
- Neutral: `host` is a third way to declare a plugin beside `wasm` and
  `process`, and the Settings page says so.
