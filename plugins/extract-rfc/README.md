# extract-rfc

RFC and RFD proposal documents in, a catalog fragment of `rfcs` out, keeping
each document's own review lifecycle and discussion metadata rather than
reading it as a decision record.

## What it reads

Markdown files matched by the `files` globs, relative to the input root; left
out, `docs/rfc/*.md`, `docs/rfcs/*.md` and `docs/rfd/*.md`. A `README.md` is
skipped. A document is YAML front matter between `---` lines, then a body
whose first non-blank line is an H1 such as `# RFC 0042 — Title` (`RFC`, `RFD`
and `KEP` prefixes are recognised; `prefix` supplies one when the heading has
none).

Front matter keys (`parse.go`): `id`, `rfc` (the number), `title`, `status`
or `state`, `scope`, `authors`/`author` and `shepherds` (a list or a
comma-separated string), `created`/`createdAt`, `updated`/`updatedAt`,
`resolved`/`resolvedAt`, `discussion`/`discussionUrl`, `relates` and `links`.
The number falls back to the heading, then to a `NNNN-` file-name prefix.
The status is mapped to a lifecycle - `draft`, `discussion`, `accepted`,
`implemented`, `rejected`, `postponed`, `withdrawn`, `abandoned`,
`superseded`, else `unknown` - through a built-in table of common spellings
(`in review`, `resolution/merge`, …) and the `statusMap` option, matched
case-insensitively. The original status word is kept beside it.

The descriptor asks the host for `history` (portolan.0007); created and
revised commits fill `createdAt`/`updatedAt` when the front matter does not.

## What it emits

A fragment with empty `contexts`, `defs`, `flows` and `adrs`, and `rfcs`
carrying `id` (the front matter's, else `<scope>.<prefix>.<number>`),
`slug`, `displayId` (`RFC-0042`), `number`, `title`, `status`, `lifecycle`,
`scope` (`org`, a context, or a service), the body, `authors`, `shepherds`,
the three dates, `discussionUrl`, `sourceKind: file`, `repository` (the `repo`
option), `source`, `relates`, `links`, and `created`/`revised` commits.

A document is left out with a warning when it has no front matter, no H1, no
title, no status, a scope that is not `org`/context/service, a date that is
not `YYYY-MM-DD` or RFC 3339, or an id or slug another file already declared.

## Options

`files`, `scope`, `prefix`, `repo`, `history` (`git`|`none`), `statusMap`,
`out` (`rfc.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "rfc", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "rfc", "in": ".", "out": "portolan",
      "options": { "files": ["docs/rfcs/*.md"], "scope": "org", "repo": "github.com/acme/architecture",
                   "statusMap": { "in progress": "discussion" } } }
  ]
}
```

RFCs kept on a forge rather than in the tree are read by the `fetch-github-rfcs`
host plugin instead.

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `rfc`; or `go run ./plugins/cmd/portolan-go rfc`.

## Limits

- Front matter is required; a document without it is not read.
- An unmapped status is preserved with lifecycle `unknown`, never guessed.
- Who committed a document is answered only inside a git checkout.

## Tests

`go test ./plugins/extract-rfc/...`; the documents are inline in
`extract_test.go`.
