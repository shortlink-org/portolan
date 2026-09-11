# portolan.0013 — What should run is read from the GitOps tree, and laid under what does

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-11
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0013-what-should-run-is-read-from-the-gitops-tree-and-laid-under-what-does.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0013-what-should-run-is-read-from-the-gitops-tree-and-laid-under-what-does.md)

### Context and Problem Statement

portolan.0012 reads where a service runs off the deployer, as a snapshot,
and left the other source open: the GitOps tree that tells the deployer
what to run. The two answer different questions. The tree says what should
be deployed - which directory, tracking which revision, into which cluster
and namespace, pinning which image - and says it in a commit, reproducibly,
with no token. The deployer says what is - the revision synced, the images
running - and says it over a socket. An estate that keeps both wants both,
and wants the difference most of all: a tag bumped in the tree that the
cluster does not run yet is the fact a reader opens the page for.

Reading the tree is not reading a list of Applications. Since
ApplicationSets, the Applications are made from generators, and what a
tree holds is the recipe: a matrix of the environments under `envs/*` and
the services under each. Some generators can be expanded from the tree
alone; some ask a cluster, a forge or a plugin.

### Decision Drivers

- The tree is a tree: reading it is an extractor's, as wasm over the
  workspace (portolan.0006), and needs no token.
- Regenerating from the same sources must change no byte (portolan.0010).
- One Application must be one row a reader sees, however many sources
  spoke for it; the difference between them must not be lost in the fold.
- A generator a tree cannot expand must be a warning naming it, never a
  guess at what the controller would have made.
- The join of a deployment to a service must be the one portolan.0012
  settled on: the labels when the Application carries them, the path
  otherwise.

### Considered Options

1. **An extractor over the tree, and a fold in the merge**: `extract-argocd`
   expands what it can and writes rows with basis `manifest`; `fetch-argocd`
   writes rows with basis `api`; the merge lays a manifest row under the
   api row of the same id and keeps their differences as drift.
2. **Two rows per Application**, one from each source, shown side by side.
3. **The extractor only**, dropping the fetcher: the tree is enough.
4. **Expand every generator** by asking Argo CD to render the
   ApplicationSet, as the fetcher already talks to it.

### Decision Outcome

Chosen option: **an extractor over the tree, and a fold in the merge.**

`extract-argocd` runs as one more entry of `portolan-go.wasm` over a
GitOps tree. It reads every Application and ApplicationSet under the paths
named and expands the generators a tree can answer: `list` whole; `git`
directories and files by walking the same repository - repository-relative
paths from the workspace root, a `**` walked as one level and said so; and
`matrix` over those, the second generator rendered with each row of the
first, which is what lets `envs/{{.env}}/shop/*` follow `envs/*/cluster.yaml`.
The template is rendered the way the ApplicationSet declared it: Go
`text/template` under `goTemplate`, else `{{a.b}}` over the flattened row.
A `clusters`, `pullRequest`, `scmProvider`, `merge` or `plugin` generator,
and a `git` generator pointing at another repository, is a warning naming
the ApplicationSet and no rows.

Each Application, declared or rendered, is reduced the way the fetcher
reduces the API's answer, minus what a tree cannot know - no revision, no
running image, no link - plus what a tree can know first: when the source
path holds a `kustomization.yaml`, the tool is kustomize and the images the
overlay pins are the declared images. The row carries basis `manifest`.

`fetch-argocd` now marks its rows basis `api`. The merge holds one row per
id. A manifest row and an api row fold into one: the api row's shape, since
it is what runs; the manifest filling a service the labels name or an image
the overlay pins when nothing runs yet; and the fields the two disagree on -
project, cluster, namespace, path, tracked revision, pinned images not
running - kept as the tree's word under `drift`, with basis `both`. Two
rows of one basis for one id are a collision and are reported as one. A
row with drift is a `deployment-drift` problem on the service's row, and
the service page wears a `drift` chip that says the difference in words; a
row only the tree spoke for wears `declared`.

#### Consequences

An estate that keeps a GitOps tree reads its deployments in CI, offline,
with no token, and gains the snapshot's revisions and images whenever a run
with a token refreshes it. The service page shows one row per environment
either way. The Problems page shows where the tree and the deployer have
parted, which is the one place a reader would otherwise open two tools to
find.

The catalog gains two fields on a deployment, one type and one problem
kind. The Go mirror follows. Nothing is added to a service.

Option 2 shows the same Application twice on every page for the ordinary
case, agreement, to make the rare case, disagreement, visible; a fold with
drift makes disagreement visible and agreement quiet. Option 3 loses what
runs, which is the question portolan.0012 was answering. Option 4 needs
the token and the socket for the part of the work that needs neither, and
answers nothing the tree cannot for the generators a tree can expand; for
the ones it cannot, it is the case for a later need, not for making the
common case need a control plane.
