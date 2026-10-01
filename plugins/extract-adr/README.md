# extract-adr

Decision records written by hand in, a catalog fragment of `adrs` out. The
record stays the document a person wrote: everything from its first `##`
heading onward goes into the catalog as written and is never regenerated from
the model.

## What it reads

Markdown files matched by the `files` globs, relative to the input root; left
out, `docs/adr/*.md`. A `README.md` among the matches is an index, not a
record, and is skipped. Two shapes are read, in `parse.go`:

- MADR-shaped: `# auth.0003 — Title`, then bullets `- **Status:**`,
  `- **Date:**`, `- **Scope:**` (required) and `Superseded by`, `Supersedes`,
  `Relates`, `Note` (optional). `Relates` mixes event ids, service ids and
  flow slugs in one list; they are told apart by shape.
- adr-tools: `# 2. Title`, a `Date:` line, and a `## Status` section whose
  first words are the status, or `Superseded by [5. …](0005-….md)`. The id's
  prefix and the scope come from the `scope` option.

Titles such as `# ADR-0003: Title` and a plain title numbered by its file name
(`0003-title.md`) are read too. Status words are matched case-insensitively,
in English and Russian (`proposed`, `draft`, `pending`; `accepted`,
`approved`, `adopted`; `superseded`; `deprecated`, `obsolete`; `rejected`,
`declined`).

The descriptor asks the host for `history` (portolan.0007): when each file was
first committed and last changed. A record with no `Date` takes the day it
was first committed.

## What it emits

A fragment whose `contexts`, `defs` and `flows` are empty and whose `adrs`
hold one record each: `id`, `slug` (id plus file name), `title`, `status`,
`date`, `scope` (`org`, a context, or a service), `supersedes`,
`supersededBy`, `relates`, `note`, the body, `source` spelled from the
repository the file lives in, and `created`/`revised` commits (commit, author,
date) when the history held them.

A file that does not parse, or declares an id or slug another file already
declared, is left out with a warning naming the file and line. A
supersession recorded on only one of its two halves fails the run.

## Options

`files`, `scope`, `history` (`git` by default, `none` to read no history and
silence the "not inside a git checkout" warning) and `out` (`adr.json`). See
`options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "adr", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "adr", "in": "examples/auth", "out": "examples/auth/portolan", "options": { "out": "adr.json" } },
    { "plugin": "adr", "in": "adr", "out": "portolan", "options": { "files": ["*.md"], "scope": "portolan" } }
  ]
}
```

## Runtime

Go, compiled with every other built-in Go plugin into `plugins/portolan-go.wasm`
(`npm run plugins:build`, GOOS=wasip1) and run by the host with the manifest
name `adr`. The same code runs as a process with
`go run ./plugins/cmd/portolan-go adr`.

## Limits

- A supersession whose other half lives in another tree is not checked here;
  the validator of the merged catalog reports it.
- Prose between the title and the first `##`, a bullet the format does not
  have, a relation of no recognisable shape, and a record with no body are
  each refused with a message naming the line.
- Who committed a record is answered only for a root inside a git checkout.

## Tests

`go test ./plugins/extract-adr/...`. Fixtures under `testdata/`: `estate`,
`golden` (a golden fragment), `lenient` (hand-written variants) and `broken`.
