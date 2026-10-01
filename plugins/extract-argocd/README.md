# extract-argocd

The Argo CD Applications and ApplicationSets in a GitOps tree in, the
deployments they declare out: which service, from which directory of which
repository, into which cluster and namespace, tracking which revision. It reads
what should run and never what does - no sync state, no revision synced, no
running image. Those come from `fetch-argocd` (portolan.0012), and the merge
lays the two over each other and calls the difference drift (portolan.0013).

## What it reads

Every `.yaml`/`.yml` under the `paths` directories (the whole root when none
are named), skipping `.git`, `node_modules`, `vendor` and `target`. A file
that will not parse is a warning naming the file. Only documents whose
`apiVersion` starts with `argoproj.io/` and whose kind is `Application` or
`ApplicationSet` are kept.

An ApplicationSet is expanded the way the controller expands it, as far as a
tree can (`appset.go`): `list` generators whole, `git` generators by walking
the directories or files of the same repository (the tree, when `repo`
matches the generator's `repoURL` or is unset), `matrix` over those. Both Go
template (`{{.cluster.name}}`) and fasttemplate (`{{cluster.name}}`) syntax
are rendered. The `merge`, `clusters`, `pullRequest`, `scmProvider` and
`plugin` generators are passed over with a warning naming the ApplicationSet.

When the Application's `path` holds a `kustomization.yaml`, the images it pins
(`newName:newTag` or `newName@digest`) are read.

## What it emits

A fragment with empty `contexts`, `defs`, `flows` and `adrs`, and
`deployments` sorted by id. Each one carries: `id` (`<namespace>/<name>`, the
namespace defaulting to `argocd`), `name`, `project` (`default` when unset),
`environment` (the `env` label, else the cluster), `cluster`
(`destination.name`, `in-cluster` for `https://kubernetes.default.svc`, else
the server URL), `namespace`, `repo` as `host/owner/name`, `path`, `chart`,
`targetRevision`, `tool` (`helm`, `kustomize`, `plugin`, `directory`),
`basis: manifest`, `images` from the overlay, and `service`
`<context>.<service>` when the labels `app.kubernetes.io/part-of` and
`app.kubernetes.io/name` are both present. A multi-source Application
deploys the source that carries a `path`.

An Application without a name is passed over; one declared twice keeps the
first; a tree with none is a warning.

## Options

`repo`, `paths`, `environmentLabel` (`env`), `labels.context` and
`labels.service` (the Kubernetes recommended labels), `out` (`argocd.json`).
See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "argocd-gitops", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "argocd-gitops", "in": "examples/gitops", "out": "examples/gitops/portolan",
      "options": { "repo": "github.com/shortlink-org/portolan", "paths": ["bootstrap", "appsets"], "out": "argocd.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `argocd-gitops`; or `go run ./plugins/cmd/portolan-go argocd-gitops`.
Git-generator paths are walked from the repository root the host names in
`input.repository`, so a fetched copy reads `apps/pricing` where the
controller would.

## Limits

- A git generator pointing at another repository cannot be walked.
- Generators that ask a control plane, a forge or a plugin produce no rows.
- Overlays are read for images only; nothing is rendered with Helm or
  kustomize.

## Tests

`go test ./plugins/extract-argocd/...`. One test reads this repository's
`examples/gitops` tree.
