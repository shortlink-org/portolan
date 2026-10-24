# extract-deployment-values

Environment-shaped YAML values in, source-backed configuration bindings out.
The extractor is the deterministic bridge between variables observed in code
and deployment overlays such as `.helm-ovh/configmap.prod.yaml`; it does not
use an LLM and never creates a service relationship by itself.

## What it reads

Only the YAML files explicitly listed in `paths`. Discovery offers those files
when at least two uppercase YAML keys exactly match environment variables used
by source code in the same project. The environment is read from a filename
segment such as `prod`, `dev`, `staging`, `test`, or `qa`; otherwise it is
`unplaced`.

Only keys listed in `variables` become bindings for `<context>.<service>`;
unrelated YAML values are ignored. Values whose names contain `PASSWORD`, `PASS`, `TOKEN`, `SECRET`, `PRIVATE_KEY`, or
`ACCESS_KEY` are never emitted. A `vault:` value is retained as a secret
reference; other sensitive values are represented by `secretRef: "redacted"`.

## What it emits

`configurationBindings` keyed by service, environment, and variable, each with
its source file and line. Enrichment may use a binding to refine an HTTP call
whose extracted base URL names the same environment variable. It requires the
configured environments to select the same provider and never invents a call
from configuration alone.

## Options

`context`, `service`, `paths`, `variables`, and `out`
(`deployment-values.json`). See
`options.schema.json`.

## Runtime and tests

Go, part of `plugins/portolan-go.wasm`; run with
`go run ./plugins/cmd/portolan-go deployment-values`.

`go test ./plugins/extract-deployment-values`.
