# extract-glossary

A context's `GLOSSARY.md` in, a catalog fragment of `terms` out: one meaning
per word inside one bounded context. The parser reads the shape of the file
and never the prose - a glossary is a person explaining a word to another
person.

## What it reads

`GLOSSARY.md` at the input root, or the `files` globs. The format
(`parse.go`):

```
# Glossary — auth

One meaning per word inside this context.

**Session.** Proof that a user logged in, how long that proof is good for,
and whether it has been taken away.
```

A title opening with `# Glossary`, an optional preamble, then one paragraph
per term in alphabetical order, each opening with the term in bold and the
full stop inside the bold (`**Email address.**` names a two-word term).
Paragraphs are flattened across soft line breaks; the definition is
everything after the term, as written.

## What it emits

A fragment whose `contexts`, `defs`, `flows` and `adrs` are empty and whose
`terms` carry `id` (`<context>.<slug>`), `slug`, `context`, `name`,
`definition` and `source` (`file:line`, spelled from the repository).

Errors fail the whole run rather than writing half a vocabulary: a file that
is not a glossary, a table, a heading per term, a list, an entry naming
nothing or saying nothing, and the same word defined twice in one file or
across files of one context. Warnings cost a reader a moment and nothing
else: entries out of alphabetical order, a glossary with no terms, a root
with no glossary.

## Options

`context` (the input directory's name when left out; must be a slug), `files`,
`out` (`glossary.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "glossary", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "glossary", "in": "examples/auth", "out": "examples/auth/portolan",
      "options": { "context": "auth", "out": "glossary.json" } }
  ]
}
```

A glossary sits beside a service, and its words belong to the context the
service is in, so `shop/oms/GLOSSARY.md` is read with `context: shop`.

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `glossary`; or `go run ./plugins/cmd/portolan-go glossary`.

## Limits

- Only the one format above is read; a glossary kept as a table or a list of
  headings is refused with a message saying so.
- A term is a paragraph; structure inside the definition is not read.

## Tests

`go test ./plugins/extract-glossary/...`. Fixtures under `testdata/` (`estate`,
`golden`, `broken`, `twice`); one test reads every glossary of this
repository's examples.
