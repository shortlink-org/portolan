# gen-markdown

The merged catalog in, a directory of Markdown out: a page per context,
service, aggregate, store, external, flow, decision and proposal, plus the
indexes and the two files a language model starts from. The plugin never
touches the filesystem; it names files and the host writes them, which is
what lets it run as a wasm module and makes `--check` a comparison.

## What it reads

The merged catalog handed in the request, canonicalised first
(`canonical.go`) so the same estate renders the same bytes whatever order
the fragments arrived in. No tree is read.

## What it emits

The layout is decided before anything is written (`render.go`), so every
page knows where every other page is:

- `README.md` - the index: contexts, externals, flows, decisions, proposals;
- `types.md` - shared type definitions; `modules/README.md` and
  `modules/<slug>.md` - proto modules;
- `<context>/README.md`, `<context>/<service>/README.md`,
  `<context>/<service>/aggregates/<slug>.md` (events are documented on the
  aggregate that publishes them), `<context>/<service>/stores/<slug>.md`
  (a store whose owner is not in the catalog sits at `stores/<id>.md`, with a
  warning);
- `externals/<slug>.md`; `flows/README.md` and `flows/<slug>.md` (with a
  Mermaid sequence diagram per flow); `adr/README.md` and `adr/<id>.md`;
  `rfc/README.md` and `rfc/<slug>.md`;
- `llms.txt` - the index as flat lists in the llmstxt.org shape - and
  `llms-full.txt`, every page already rendered, concatenated in site order.

A reference to an id the catalog does not hold is rendered as code, not as a
link: an event consumer or an rpc peer in a source this render never saw is
the normal case. Source locations become links when `sourceBaseUrl` is set;
files in fetched repositories link through their commit pin. Glossary terms
are listed on the context they belong to; decisions and proposals on the
org, context or service they are scoped to.

## Options

`title` (the index heading; the one thing the catalog does not say) and
`sourceBaseUrl`. See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "markdown", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "generate": [
    { "plugin": "markdown", "catalog": "portolan", "out": "docs",
      "options": { "title": "Portolan", "sourceBaseUrl": "https://github.com/shortlink-org/portolan/blob/main" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `markdown`; or `go run ./plugins/cmd/portolan-go markdown`. The
host deletes pages that stop being generated.

## Limits

- Output is deterministic by construction: maps are sorted, no clock is
  read, and a permutation test holds it to that.
- Every catalog field must be rendered or explicitly acknowledged; the
  coverage test fails when a new field is neither.
- The relative links assume the whole directory is mounted together.

## Tests

`go test ./plugins/gen-markdown/...`: schema and field coverage, byte-for-byte
permutation, generated-link and anchor checks, and Mermaid parsing.
