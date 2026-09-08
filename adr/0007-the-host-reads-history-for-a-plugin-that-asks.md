# portolan.0007 — The host reads history for a plugin that asks

- **Status:** accepted
- **Date:** 2026-09-08
- **Scope:** portolan

## Context and Problem Statement

`adr` says who first committed a decision record and who last changed it.
That is a fact about the checkout, not the tree, and the extractor read it by
running `git log --follow` per file - the one thing in it a wasm module cannot
do. portolan.0006 moved every other built-in Go plugin into one sandboxed
module and left `adr` a process for exactly this reason, which kept `go run`,
the Go sources and a Go toolchain in the package for a single field.

The host already reads git: every fragment's stamp comes from it
(portolan.0002). The question is where the file history should be read, and
how a plugin says it wants it.

## Decision Drivers

- No plugin runs git; a built-in Go plugin must be able to run as wasm.
- The fragment must not change: the same commit gives the same `created` and
  `revised` on every machine, and the committed fragments must stay
  byte-identical across the move.
- A plugin that does not need history must not pay for it, and a repository
  with a long history must pay once, not once per file.
- The request must stay one JSON message; there is no second round trip.

## Considered Options

1. **The plugin declares a need and the host puts the history in the
   request** - `needs: ["history"]` in the descriptor, `input.history` keyed
   by file path, read from one `git log` over the checkout.
2. **The host answers a callback** - a second protocol message the plugin
   sends when it wants a file's history.
3. **The plugin reads `.git` itself** through the preopened workspace.
4. **`adr` stays a process.**

## Decision Outcome

Chosen option: **the plugin declares a need and the host puts the history in
the request**.

The descriptor gains `needs`, a list of what the host must add to the
request beyond the tree; `history` is its first value. Before an extract
step the host asks the plugin to describe itself once per run, and for a
plugin that asks it reads `git log --reverse --name-status -M` over the
whole checkout once, follows renames forward, and hands the step the files
under its root as `input.history`: for each path, the commit that first
added it and, when a later commit touched it, the last one. The map is
absent when the root is not inside a checkout, which the plugin reports in
its own words, as it did when git said so. A plugin told `history: "none"`
ignores the map, as it ignored git.

A callback would have made the protocol two messages for one field. Reading
`.git` from a module means a git implementation in every language a plugin
is written in, and a rename followed differently in each. Leaving `adr` a
process was the state this record replaces.

### Consequences

- Good: `adr` is in `plugins/portolan-go.wasm` with the rest; no built-in
  extractor, verifier or generator runs as a process.
- Good, and a change: `git log --follow` also follows copies, and had dated
  three records in `data/adr` by the generated page under `docs/` they were
  ninety percent similar to. The host follows renames only, so a record is
  dated by the commit that added it, which is what "created" was meant to
  say. Every other fragment is byte-identical.
- Good: history is read once per checkout per run, and only when a step's
  plugin asks. A plugin that wants nothing beyond the tree is unaffected.
- Bad: a plugin's file names must match the host's: the path as the plugin
  would open it, relative to the workspace. A plugin that renames what it
  reads finds nothing in the map.
- Bad: one log over the whole checkout is what makes renames from outside a
  root followable, and on a very large repository it is the cost of the
  first `adr` step in a run.
- Neutral: `fetch-git` and `fetch-bsr` are still processes. They need a
  socket, which no need in a request supplies, and the Go sources ship for
  them until they move into the host.
