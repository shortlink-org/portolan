# gen-mermaid

The merged catalog in, one standalone Mermaid sequence diagram per flow out,
with an index. The diagram text is produced by `render/mermaid`, the same
renderer the Markdown pages embed.

## What it reads

The merged catalog handed in the request. No tree is read.

## What it emits

- `<slug>.mmd` per flow, sorted by slug: a `sequenceDiagram` with the flow's
  participants and steps, `alt`/`par`/`loop` frames included. An rpc step's
  label is extended with the method's response type when the catalog knows
  it (`GetQuote → QuoteResponse`); a store access is labelled by its
  operation and keyspace; a step that a response step replies to keeps its
  plain label.
- `README.md`, headed by `title` ("Architecture flows" when unset), listing
  every diagram with the flow's id.
- `index.json`: `{ "version": 1, "flows": [{ id, slug, name, owner, source,
  diagram }] }`.

## Options

`title`. See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "mermaid", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "generate": [
    { "plugin": "mermaid", "catalog": "example", "out": "exports/mermaid/example",
      "options": { "title": "Example estate flows" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `mermaid`; or `go run ./plugins/cmd/portolan-go mermaid`.

## Limits

- Flows only; no other diagram kind is exported here.
- The files are Mermaid source, not rendered images.

## Tests

`go test ./plugins/gen-mermaid/...` holds the output sorted and indexed;
`go test ./render/mermaid/...` holds the diagram grammar.
