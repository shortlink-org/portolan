# portolan.0012 — Where a service runs is read from the deployer, as a snapshot

- **Status:** accepted
- **Date:** 2026-09-11
- **Scope:** portolan

## Context and Problem Statement

portolan.0011 reads the names a service answers on and dials, from the
manifests in a repository and from a live cluster, and keeps nothing else;
it leaves an environment and a cluster as things of their own to a decision
made when a page asks for them. This is that page. Neither a tree nor a
cluster says which revision of which repository stands in which cluster and
namespace today, under what name, running which images: a tree says what
should run, a cluster shows objects with no revision on them, and only the
thing that deploys knows the two together. The answer is the state of a
control plane.

The question is asked on a service page: is this in production yet, at
which commit, and where do I look. Answering it means reading Argo CD,
which needs a socket and a token, and means keeping something that has no
commit of its own to pin to.

## Decision Drivers

- The fact is not in a tree, so no extractor can read it (portolan.0006);
  reading it needs a socket and a credential, which are the host's
  (portolan.0008).
- Regenerating from the same sources must change no byte (portolan.0010).
  A build must not read a clock, and CI must not need a token or a control
  plane that is up.
- Nothing that moves without a deploy may reach a page. A page that said
  "healthy" and was not regenerated since is a page that lies.
- No value from the deployer - a Helm parameter, a plugin env, a
  credential - may reach a fragment, a warning or a page, for the reason
  portolan.0011 gives.
- The fetcher reads a control plane and knows no service; which service an
  Application is has to be decided where the whole estate is known.

## Considered Options

1. **A host plugin reads the Argo CD API into a snapshot** committed
   beside a lock, replayed offline, reduced to what a deploy changes.
2. **An extractor reads the Application manifests** from the GitOps
   repository, fetched with `fetch-git` like any other tree.
3. **Keep the status too**: health, sync state, the last operation, so the
   page shows what the deployer shows.
4. **The fetcher writes the deployment onto the service**, joining by name
   or label at fetch time.

## Decision Outcome

Chosen option: **a host plugin reads the API into a snapshot.**

`fetch-argocd` is declared as `{ "name": "argocd", "host": "fetch-argocd" }`
and runs like `fetch-bsr`: one call to `/api/v1/applications`, narrowed by
project and selector, with `ARGOCD_AUTH_TOKEN` as the argocd CLI reads it
and nothing in the manifest. It names two files. `argocd.apps.json` is a
catalog fragment holding `deployments` and nothing else; `argocd.lock.json`
holds the server, the applications and the fragment's digest. Offline and
in CI the committed snapshot is replayed against the lock and the file list
is identical; a fetch that fails falls back to it with a warning; a fetch
that fails with no snapshot is an error, never a short file list.

There is no pin, because there is nothing to pin to: an Application has no
immutable commit the way a module or a repository has. The snapshot is the
fact, and it moves when a deploy moves it. An online run after a deploy
changes the committed snapshot, and that diff - what went where - is the
review worth having.

What is kept is what a deploy changes: the environment, the cluster, the
namespace, the repository and directory the manifests come from, what the
Application tracks and what it resolved to, the tool, the images, and the
link to the Application. What is not kept is what moves without one: health,
sync state, the time of the last operation. The link goes to where they
live. No parameter and no value is read at all; the source's `helm` and
`plugin` blocks are not looked into.

`Deployment` is a list on the catalog, beside `repos`, and the join is made
in the index: an Application is a service's when it deploys from the
service's repository, inside the service's directory. An Application of a
repository nobody in the estate claims matches nothing and is not an error;
a control plane manages more than the estate's services.

### Consequences

The service page gains "Where it runs": one row per environment the
snapshot places it in, with the commit as a link to the forge, the images,
and the Application. The catalog gains one list and one index; the Go
mirror gains the struct, held by the round-trip test over the committed
snapshot.

The snapshot is only as current as the last online run, and says so by
being a committed file with a history. An estate that wants it current
runs `gen` on a schedule and reviews the diff; an estate that does not can
leave the step out and lose nothing else.

The environment is the application's label, `env` unless the manifest
names another, and the cluster when there is none: Argo CD has no
environment of its own, and this is the fact closest to one.

Option 2 answers a different question: what the GitOps repository says
should be deployed, which is a tree and could be read by an extractor -
but not what is, nor at which revision, nor with which images, and an
ApplicationSet with a cluster generator is not readable without the
cluster. It remains open for an estate whose Argo CD nobody may call.
Option 3 would put a fact that changes every hour into a file regenerated
once a day. Option 4 would have the fetcher guess a service from a name,
in the one place the estate is not known.
