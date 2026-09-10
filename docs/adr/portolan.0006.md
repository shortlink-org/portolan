# portolan.0006 — An extractor runs as wasm over a preopened workspace

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-06T20:39:44+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-08
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0006-an-extractor-runs-as-wasm-over-a-preopened-workspace.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0006-an-extractor-runs-as-wasm-over-a-preopened-workspace.md)
- **Committed:** Victor Login, 2026-09-08 (`7cd7fee`)

### Context and Problem Statement

This decision is amended by portolan.0009 for the HTTP client extractor: its
SSA/VTA pass requires the project Go toolchain and runs as a native sidecar.

portolan.0001 made a generator a wasm module with nothing preopened, and left
the read side alone in its last consequence: an extractor reads a tree, so
extractors stayed processes. This record amends that consequence. Every built-in Go extractor, `project` included, is therefore
`go run`, and the first `portolan generate` after `portolan init` fails on a
machine without Go even when the repository is TypeScript. The toolchain
being asked for is not the one the repository uses; it is the one the
extractor happens to be written in.

A module compiled for `wasip1` can read a directory the host preopens. Every
Go extractor and verifier compiles for that target unchanged, and over a
preopened workspace produces the same fragment, byte for byte, in tens of
milliseconds instead of a compile.

### Decision Drivers

- `init → generate → dev` must run with Node alone for a repository that
  needs no other toolchain. Go, Cargo, Java and Python are asked for only by
  the extractor of that language.
- An extractor from somebody else's repository must still not get the
  network, the environment, or a way to start a process.
- The protocol of portolan.0001 stays: a plugin names files, the host writes
  them.
- The package must stay small enough to `npx`.

### Considered Options

1. **Preopen the workspace for extract and verify steps; generators keep
   nothing.** One multi-call module carries every Go plugin.
2. **Keep extractors as processes and ship prebuilt native binaries** per
   platform.
3. **Keep extractors as processes** and document the Go requirement.

### Decision Outcome

Chosen option: **preopen the workspace for extract and verify steps**.

The host preopens the manifest's workspace as `/` for the extract and verify
phases only, and passes the step's `in` as the relative root it always did.
A generate step, and a `describe` request, still run with nothing preopened.
A module gets the plugin name as `argv[0]`, which is how one module answers
for every built-in Go plugin: `plugins/portolan-go.wasm` dispatches on it,
and the same package runs as a process for a plugin that still needs one.

What the sandbox now promises for an extractor is: no network, no
environment, no way to spawn, and no path outside the workspace. It does not
promise read-only. Node's WASI preopens a directory read-write, and a module
that wanted to could write into the tree it was asked to read. That is the
same trust as a process plugin has today, minus everything else a process
can do, and it is the honest statement rather than a stronger one the runtime
cannot back. A `sha256` on a fetched module is what pins that trust to a
build.

Native binaries were rejected because a matrix of platforms is exactly the
packaging burden wasm removes. Documenting the requirement was rejected
because it keeps the failure where new users meet it first.

#### Consequences

- Good: a TypeScript repository reads itself with Node alone; `init` and
  `doctor` derive toolchain requirements from plugin definitions and stop
  naming Go.
- Good: one module instead of nineteen binaries; a step starts in
  milliseconds; the package ships one `.wasm` and no longer needs
  `go build` at first use.
- Bad: a wasm extractor cannot read git history. `adr` reads when a record
  was first committed, so it stays a process until the host supplies history
  in the request.
- Bad: extractors are not read-only in the WASI sense. A module that writes
  into the workspace is a bug the host cannot prevent, only a diff will show.
- Neutral: `fetch-git` and `fetch-bsr` need a socket and stay processes, as
  do the Rust, Java, Python and TypeScript extractors, which run in their own
  toolchains.
