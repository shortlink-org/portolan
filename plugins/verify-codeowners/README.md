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

No forge option is needed. The verifier inspects the conventional locations
and GitLab-only syntax, then uses GitHub's order (`.github/CODEOWNERS`, root,
`docs/CODEOWNERS`) or GitLab's order (root, `docs/CODEOWNERS`,
`.gitlab/CODEOWNERS`). Explicit `file` remains available for an existing manifest
or a non-standard location. A named file that is absent, or nothing found,
fails the run.

GitHub uses flat last-match-wins rules, including an ownerless rule taking
ownership back. GitLab applies last-match-wins independently in every section
and unions the winners; section defaults, optional/count annotations, roles,
escaped spaces and `!` exclusions are understood. Duplicate GitLab section
names are case-insensitive. Unsupported GitHub negation, character ranges and
escaped leading hashes are skipped as GitHub skips them.

Patterns are matched against each service's `path` as the catalog holds it,
so they are repository-relative wherever the file sits.

## What it emits

A fragment with one context per context that has an owned service, and for
each such service only its `id`, `slug` and `owners` - the handles of the
last rule that matched. Nothing else about the service is restated.

Warnings name a service with no path, a service no rule matches, a rule that
matches no service, a rule that matches something but never wins, and a file
with no rules.

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
- Matching projects file-level CODEOWNERS onto catalog service directories is
  intentionally a projection: a rule about only an internal file does not own
  the whole service page.

## Tests

`go test ./plugins/verify-codeowners/...`, including last-match-wins,
taking ownership back, and a stable fragment.
