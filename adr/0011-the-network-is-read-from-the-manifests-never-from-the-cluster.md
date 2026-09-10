# portolan.0011 — The network is read from the manifests, never from the cluster

- **Status:** accepted
- **Date:** 2026-09-11
- **Scope:** portolan

## Context and Problem Statement

The catalog knows what a service provides and what it consumes, and the merge
joins the two by route: a client's `POST /foo` meets the one service whose
OpenAPI or framework fragment declares it. Where two services declare the
same route, or where the client's code names its destination only as
`$LEDGER_URL`, the join has nothing to go on and the call stays unresolved.

What the variable holds is not in the code. It is in what deploys the
service: the Deployment's `env`, the ConfigMap it reads, and the Service,
Ingress and HTTPRoute objects that give the far end a name. That is also
where the passwords are. A reader of those files has to answer two questions
at once: where to read the network from, and what of what it reads may reach
a fragment that is committed, rendered and published.

## Decision Drivers

- The join needs the one fact a route cannot carry: which of the estate's
  services answers on the name the caller is configured with.
- Regenerating from the same sources must change no byte (portolan.0010); a
  fact must change when a commit changes it, and not otherwise.
- No plugin may need a socket, a credential or a binary (portolan.0006,
  portolan.0008).
- No value from a manifest - a password, a token, a DSN, a flag, a level, a
  variable's name - may reach a fragment, a warning or a page. The build
  report is committed too.
- Internal DNS names may: a name is topology, and the catalog is a map.

## Considered Options

1. **Read the manifests in the repository**, as a wasm extractor over the
   tree, and keep names only: the hosts a service answers on and the
   in-cluster hosts its workload dials.
2. **Ask the cluster**, through `kubectl get -o json` from a host plugin,
   with a cached snapshot and a lock for offline replay.
3. **Keep the configuration**: put a service's environment - variable and
   value - into the catalog, and let the merge resolve from it.
4. **Do nothing**: leave such calls unresolved and let a flow written by
   hand say where they go.

## Decision Outcome

Chosen option: **read the manifests, keep names only.**

`extract-k8s` runs as one more entry of `portolan-go.wasm` over a preopened
tree. It puts two lists on a service. `hosts` are the names the service
answers on: a Kubernetes Service's name in its short, namespaced, `svc` and
fully qualified forms, and the hosts of the Ingress or HTTPRoute in front of
it. `dials` are the in-cluster names the workload is configured to reach,
read from its containers' `env` and the ConfigMaps they reference and reduced
to the host alone. The merge resolves an ambiguous route to the one provider
that answers on the host the call names, or on a host the caller dials, and
the evidence says `kubernetes-host` as the basis.

What keeps values out is a rule of shape, not a list of words. A `Secret`,
`SealedSecret`, `ExternalSecret` or any document carrying `stringData` is
passed over at its `kind`, before its body is decoded; a `secretKeyRef` or
`secretRef` is not followed. Every other value is looked at once, in memory,
for one purpose - does it name a host inside the cluster - and what survives
is the hostname: a URL gives up its scheme, port, path, query and the user
and password in front of the host, and a bare `host[:port]` gives up the
port. What is left qualifies only when the cluster resolves it: a form one of
the tree's own Services answers to, or `<name>.<namespace>.svc`, the one
shape no name outside a cluster has. A password does not look like that, nor
does a token, a level or a flag; a bare word from another repository is not
taken either, because nothing tells it from a word. Warnings name files and
directories, never values.

Nothing is read from a cluster, and no environment or config map value is
kept.

### Consequences

The extractor is deterministic and needs nothing the tree does not hold, so
it runs in CI, under `--check`, and offline. Helm templates are not YAML
until rendered and are passed over with a warning per directory; a chart is
read by rendering it into the tree, which is a build step and not this
plugin's. Kustomize is read without running it: base and overlays fold by
kind and name.

A caller's `dials` from one repository and a provider's `hosts` from another
meet only in the merge, which is where every cross-repository fact meets.

The catalog gains two list fields on a service and one basis on the
evidence, and no entity. An environment, a cluster, an Ingress as a thing of
its own: each is a page nobody has asked for yet, and a decision to be made
when one does.

Option 2 answers a different question - what runs now, not what the
repository says should run - and the answer moves without a commit, needs a
credential in the build, and would have to be snapshotted and locked to be
reproducible at all. Where the manifests are not in any repository, it is
the only source; that is a case for a host plugin later, not a reason to
make the common case need a cluster. Option 3 would put every password one
misplaced `value` away from a published page and asks the reader to trust a
list of forbidden words. Option 4 leaves the join blind exactly where the
estate is most interesting.
