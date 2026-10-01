# verify-codeowners

Who to ask about each service, read from the CODEOWNERS file the repository
already keeps and the forge already enforces. Read, never written, and never
resolved: a handle is what the file says, and turning `@acme/oms-team` into
people would need a forge credential this deliberately does not have.

It is a verifier rather than an extractor because a rule is a path, and only
the merged catalog knows where each service is. That also lets it report
the failure a CODEOWNERS file never reports about itself: a rule that owns
nothing.

## What it reads

`file`, relative to the input root, or - left out - the three places a forge
looks, in order: `CODEOWNERS`, `.github/CODEOWNERS`, `docs/CODEOWNERS`. A
named file that is not there, or nothing found, fails the run.

The grammar (`parse.go`): a pattern and the handles that own what it
matches; blank lines and `#` comments skipped, an escaped `\#` kept; the
last matching rule wins. A pattern with no owners is kept, because taking
ownership back is what it is written for. GitLab section headers
(`[Backend]`, `^[Optional]`, `[Name][2]`) are noticed and the file is read
the flatter way GitHub means, with a warning. `!` negation and character
ranges are not implemented.

Patterns are matched against each service's `path` as the catalog holds it,
so they are repository-relative wherever the file sits.

## What it emits

A fragment with one context per context that has an owned service, and for
each such service only its `id`, `slug` and `owners` - the handles of the
last rule that matched. Nothing else about the service is restated.

Warnings name a service with no path, a service no rule matches, a rule that
matches no service, a rule that matches something but never wins, a file
with sections, and a file with no rules.

## Options

`file`, `out` (`owners.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "codeowners", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "verify": [
    { "plugin": "codeowners", "in": "data/codeowners", "out": "data", "options": { "out": "owners.json" } }
  ]
}
```

Point `in` at the directory the file is in rather than at the repository
root: the host dates a fragment from the last commit touching the step's
input, and the subject of this one is the CODEOWNERS file.

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `codeowners` in the `verify` phase, after the merge; or
`go run ./plugins/cmd/portolan-go codeowners`.

## Limits

- Handles are not resolved to people or teams.
- GitLab's per-section precedence is not implemented; an owner may be
  missing for a service a section would have claimed.

## Tests

`go test ./plugins/verify-codeowners/...`, including last-match-wins,
taking ownership back, and a stable fragment.
