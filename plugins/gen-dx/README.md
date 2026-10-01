# gen-dx

The merged catalog in, an explicit DX Software Catalog apply plan out:
services as DX entities and their dependencies as relation edges. The plan is
named, never applied; `fetch-dx` independently reads DX into a fragment and
neither direction requires the other.

## What it reads

The merged catalog handed in the request. No tree is read.

## What it emits

One file, `plan.json`:

```json
{ "version": 1, "entities": [ ... ], "relationEdges": [ ... ] }
```

One entity per service, sorted by id: `identifier` (the service id),
`type` (`entityType`, or the `entityTypes` mapping for the service's
component kind), `name`, `description` (the first line of its readme),
`owner_team_ids` (CODEOWNERS handles mapped through `ownerTeamIds`;
unmapped handles are omitted), `properties` (the technologies under
`technologyProperty`, when set) and an alias of type `github_repo` or
`gitlab_repo` read from the service's `repo`.

One relation edge set under `relationIdentifier`, mapping each service to the
services it depends on - its `dependsOn` plus the peers of its `consumes` -
restricted to services the catalog holds and never to itself. No edges, no
`relationEdges` entry.

## Options

`entityType` (`service`), `entityTypes`, `relationIdentifier`
(`service-depends-on-service`), `technologyProperty`, `ownerTeamIds`. See
`options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "dx-export", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "generate": [
    { "plugin": "dx-export", "catalog": "example", "out": "exports/dx",
      "options": { "ownerTeamIds": { "@acme/oms-team": "team_123" }, "technologyProperty": "stack" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `dx-export`; or `go run ./plugins/cmd/portolan-go dx-export`. The
plan is stable across runs: entities and edges are sorted.

## Limits

- Only services become entities; contexts, stores, APIs and externals are
  not exported.
- Repositories other than github.com and gitlab.com get no alias.
- Nothing is sent to DX; applying the plan is somebody else's step.

## Tests

`go test ./plugins/gen-dx/...`.
