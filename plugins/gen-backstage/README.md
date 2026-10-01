# gen-backstage

The merged catalog in, a Backstage Software Catalog bundle out: contexts,
services, APIs, stores and schema modules as Backstage entities in one
`catalog-info.yaml`. A generator names files and never writes them
(portolan.0001).

## What it reads

The merged catalog handed in the request, for the profile the step names.
No tree is read.

## What it emits

One file, `catalog-info.yaml`, holding YAML documents separated by `---`, in
a fixed order:

- a `Domain` (`domain`, `domainTitle`);
- per external: a `Component` of type `external-service` and an `API` per
  interface it provides;
- per context: a `System` in the domain;
- per service: a `Component` whose type follows the catalog's component kind
  (`website`, `library`, `tool`, `data-pipeline`, `application`, `worker`,
  `job`, `function`, else `service`), with `system`, `dependsOn` (services
  it depends on or calls, its stores and modules as `resource:`), `providesApis`,
  `consumesApis`, tags from its technologies, links from its commands and a
  `backstage.io/source-location` annotation built from `sourceBaseUrl`, its
  path and repo; and an `API` per provided interface whose `definition` is
  Portolan's normalised JSON of the methods and messages, typed `portolan`
  rather than `openapi` or `grpc`;
- per store: a `Resource` typed by the store kind;
- per proto module: a `Resource` of type `schema-module`.

Every entity carries `portolan.io/id`. Owners come from CODEOWNERS handles
on the service (`verify-codeowners`) and fall back to `owner`. Names are
made Backstage-safe and ASCII, and every reference is validated against the
bundle before anything is returned; a dangling one fails the run.

## Options

`domain` (`architecture`), `domainTitle` (`Architecture`), `owner`
(`architecture`), `lifecycle` (`production`), `sourceBaseUrl`. See
`options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "backstage", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "generate": [
    { "plugin": "backstage", "catalog": "example", "out": "exports/backstage",
      "options": { "domain": "example-estate", "domainTitle": "Example estate", "owner": "architecture",
                   "lifecycle": "production", "sourceBaseUrl": "https://github.com/shortlink-org/portolan/blob/main" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `backstage`; or `go run ./plugins/cmd/portolan-go backstage`.
Output is deterministic: entities are sorted by id and nothing reads a
clock.

## Limits

- One bundle file; Backstage locations for several files are not written.
- The API definition is Portolan's shape, not the original document.
- A handle that is not a Backstage owner reference is written as given.

## Tests

`go test ./plugins/gen-backstage/...`, including relationship validation and
Backstage-safe naming.
