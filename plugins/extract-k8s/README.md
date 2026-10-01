# extract-k8s

Kubernetes manifests in, the names a service answers on and the in-cluster
names it dials out. Only names are read from what deploys a service
(portolan.0011): a configured value is looked at for a host and then
forgotten, and a Secret is never opened.

## What it reads

Every `.yaml`/`.yml` under the `paths` directories (the whole root when none
are named; anything without `apiVersion` and `kind` is passed over), skipping
`.git`, `node_modules`, `vendor` and `target`. A file containing `{{` is a
template, not YAML until rendered, and its directory is passed over with one
warning. `Secret`, `SealedSecret`, `ExternalSecret`, `SecretStore` and any
document with `stringData` are recognised by kind and not decoded. A
`Kustomization` is skipped: its resources are files the walk already reads,
and its patches fold by kind, namespace and name onto what they patch.

Workloads: `Deployment`, `StatefulSet`, `DaemonSet`, `ReplicaSet`, `Job`,
`CronJob` - their pod labels and container values (`env` literals,
`configMapKeyRef` followed into the tree's ConfigMaps, `envFrom`
`configMapRef`; `secretKeyRef`/`secretRef` contribute nothing, by rule).
`Service` selectors, `Ingress` rules, and Gateway API `Gateway`,
`HTTPRoute`, `GRPCRoute`, `TLSRoute` and `ReferenceGrant`. `namespace`
narrows the read to one namespace, keeping gateway objects available.

The workload the step is about is the one named like `service`, or labelled
so with `app.kubernetes.io/name` or `app`, or the only one in the tree.

## What it emits

A fragment with one context and one service `<context>.<service>`:

- `kind`: `job` for a Job or CronJob.
- `hosts`: every DNS form of each Service selecting the workload's pods
  (`name`, `name.ns`, `name.ns.svc`, `name.ns.svc.cluster.local`), the
  Ingress hosts in front of them, and the hostnames of Routes attached to a
  Gateway listener that accepts their kind, namespace and hostname
  (portolan.0018).
- `gatewayExposures`: the route, accepted listener and backend behind each
  set of hostnames, basis `manifest`, with the route's source.
- `dials`: configured values that are a bare host or a URL naming another
  Service the tree declares, minus the service's own names.

Warnings: no workload found; several workloads and none named or labelled
`service` (said, never guessed); a directory of templates; a file that does
not parse; a named path that does not exist.

## Options

`context`, `service`, `paths`, `namespace`, `out` (`k8s.json`). See
`options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "k8s", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "k8s", "in": "examples/shop/cart", "out": "examples/shop/cart/portolan",
      "options": { "context": "shop", "service": "cart", "paths": ["deploy/k8s"], "out": "k8s.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `k8s`; or `go run ./plugins/cmd/portolan-go k8s`. For names read
from a live cluster instead, `fetch-k8s` is the host plugin.

## Limits

- Helm charts are not rendered; a templated directory contributes nothing.
- A Service with an empty selector selects nothing here.
- A bare name in a value qualifies as a dial only when the tree declares a
  Service of that name.
- No value, port or secret reaches the fragment or a warning.

## Tests

`go test ./plugins/extract-k8s/...`; manifests are inline in `extract_test.go`,
and `testdata/gateway-cases.json` holds the Gateway attachment cases.
