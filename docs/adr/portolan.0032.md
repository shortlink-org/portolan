# portolan.0032 — A gRPC call outside the estate is named by the manifest and described by the copy

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-18
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0032-a-grpc-call-outside-the-estate-is-named-by-the-manifest-and-described-by-the-copy.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0032-a-grpc-call-outside-the-estate-is-named-by-the-manifest-and-described-by-the-copy.md)
- **Committed:** Victor Login, 2026-09-18 (`e43d1bb`)

### Context and Problem Statement

A system outside the estate that answers over HTTP already has a place in the
catalog: an external, described by the copy of its document vendored beside
the adapter that calls it (an `openapi` step with `external`), and joined to
the caller by the domain extractor's `externals` line, or, failing that, by
the title of the document.

A system that answers over gRPC had none. Auth asks a risk service before it
issues a session, on purpose and by a decision of its own (auth.0007), and
vendors a narrowed copy of `risk.v1` to do it. The call was recorded against
the package, unresolved, and Problems listed it twice - a call that resolves
to nothing and a flow step that lands nowhere - beside real defects. It was
true that no service here answers, and wrong that nobody knew who does.

### Decision Drivers

- One convention for an external, whatever the contract's format: the
  manifest names it, the copy describes it, the merge joins them by id.
- The catalog claims nothing about a third party beyond the copy.
- No name is guessed where the tree does not write one.

### Considered Options

- Derive the external from the package, `risk.v1` giving `risk`, the way an
  HTTP document's title gives its system.
- Map the package under the proto step's `peers`, since that is where a
  vendored copy's caller is already described.
- Keep the caller's `externals`, now for a proto package as well as an api
  id, and give the `proto` extractor the same `external` options the
  `openapi` one has.

### Decision Outcome

Chosen: `externals` on the caller's domain step, and `external` on a `proto`
step over the copy.

The domain extractor already looked a gRPC client's package up in
`externals`; what was missing was saying so, and a step that describes the
far end. A `proto` step with `external` set reads the protos under `paths` as
what that external answers on, and writes a fragment with the external and
nothing else - no context, no service, no module, no shared types, because
the copy is a narrowed excerpt the caller keeps, not a module anybody
publishes. The call is then declared against the external, and the merge
resolves it against the interface the copy declares.

A package is not a name for a system. `risk.v1` could be answered by a vendor
called anything, and `peers` is for services of the estate; neither is read as
an external without a manifest line.

#### Consequences

- Good: a gRPC call out of the estate reads the way an HTTP one does - on an
  external lane, declared, with the rpc and its messages on the external's
  page.
- Good: the proto step keeps one meaning per option; `peers` still names only
  services of the estate.
- Bad: two lines in the manifest for one external, one on each side, and
  nothing checks that they name the same id except the call that fails to
  resolve when they do not.
- Neutral: an HTTP client still falls back to the document's title; a gRPC
  client has no such fallback and stays unresolved until the manifest speaks.
