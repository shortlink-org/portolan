# portolan.0001 — A plugin names files and never writes them

*Generated from the portolan catalog · commit `13 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-02
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0001-a-plugin-names-files-and-never-writes-them.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0001-a-plugin-names-files-and-never-writes-them.md)
- **Committed:** Victor Login, 2026-09-06 (`229c1fb`)

### Context and Problem Statement

A plugin produces files: a fragment beside the service it read, pages under
`docs/`, a Backstage bundle. Who writes them to disk?

The obvious answer is the plugin. It knows the names, it has the tree, and
every code generator ever written does it that way. It is also the answer that
makes a plugin something that holds a directory: a `--check` mode then needs
the plugin to know there is a disk to compare against, a wasm module needs a
directory preopened for it, a plugin that can write can also delete, and a page
that stops being generated has nobody who remembers writing it.

### Decision Drivers

- A generator must be able to run as a wasm module with nothing preopened at
  all.
- `--check` must compare a render against disk without the plugin knowing
  there is a disk.
- A name that climbs out of the output directory must be refused in one
  place, not in every plugin.
- A page that stops being generated must be deleted by something that knows
  what was written last time.

### Considered Options

1. **The plugin answers with named files and the host writes them** — one
   JSON message out, `files: [{name, contents}]`, nothing else.
2. **The plugin writes into an output directory it is handed** — a path in the
   request, or a preopened directory for wasm.
3. **The plugin writes and answers with a listing** — so the host can at least
   delete what went stale.

### Decision Outcome

Chosen option: **the plugin answers with named files and the host writes
them**.

| | sandbox | check mode | stale pages | unsafe names |
|---|---|---|---|---|
| host writes | nothing preopened | host compares | host lists what each step wrote | refused once, in the host |
| plugin writes | a directory is open | plugin must know the disk | nobody's | every plugin's problem |
| plugin writes and lists | a directory is open | plugin must know the disk | host deletes from the listing | every plugin's problem |

What is given up is streaming: a plugin's whole output crosses one JSON
message on stdout, so a generator holds every page in memory at once and
cannot write incrementally. That is the cheaper loss, because the outputs are
documentation-sized and the sandbox is the reason the protocol has this
shape rather than a restriction worked around.

#### Consequences

- Good: `gen-markdown`, `gen-mermaid` and `gen-backstage` run as wasm with no
  filesystem, and a generator in any language is the same contract.
- Good: the host refuses a name outside the output directory, keeps a listing
  of what each step wrote, and deletes pages that stopped being generated.
- Bad: a plugin cannot stream, and a plugin cannot read what it wrote last
  time; determinism has to come from the catalog alone, which is required of
  it anyway.
- Neutral: this decides the write side only. An extractor still reads a tree,
  so extractors run as processes rather than wasm; lifting that would be its
  own record.
