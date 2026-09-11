# portolan.0011 — Only names are read from what deploys a service

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-11
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0011-only-names-are-read-from-what-deploys-a-service.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0011-only-names-are-read-from-what-deploys-a-service.md)
- **Committed:** Victor Login, 2026-09-11 (`7d85c99`)

### Context and Problem Statement

The catalog knows what a service provides and what it consumes, and the merge
joins the two by route: a client's `POST /foo` meets the one service whose
OpenAPI or framework fragment declares it. Where two services declare the
same route, or where the client's code names its destination only as
`$LEDGER_URL`, the join has nothing to go on and the call stays unresolved.

What the variable holds is not in the code. It is in what deploys the
service: the Deployment's `env`, the ConfigMap it reads, and the Service,
Ingress and HTTPRoute objects that give the far end a name. Those objects
exist in two places - as manifests in a repository, and as what a cluster
is running now - and both are wanted: the manifests because they are in git
and reproducible, the cluster because it is the truth about what runs, and
because for an estate deployed by Helm or Argo the rendered objects are in
no repository at all.

Both places are also where the passwords are. A reader of either has to say
what of what it reads may reach a fragment that is committed, rendered and
published.

### Decision Drivers

- The join needs the one fact a route cannot carry: which of the estate's
  services answers on the name the caller is configured with.
- Regenerating from the same sources must change no byte (portolan.0010);
  a run that has lost the cluster must not lose the catalog.
- A plugin that needs a socket or a binary runs inside the host
  (portolan.0008); everything else runs as wasm over the tree.
- No value from a manifest or a cluster - a password, a token, a DSN, a
  flag, a level, a variable's name - may reach a fragment, a warning or a
  page. The build report is committed too.
- Internal DNS names may: a name is topology, and the catalog is a map.

### Considered Options

1. **Read names only, from both places.** A wasm extractor over the
   manifests in a repository, and a host plugin over `kubectl`; both reduce
   what they read to the names a service answers on and the in-cluster
   names its workload dials, and write nothing else.
2. **Keep the configuration.** Put a service's environment - variable and
   value - into the catalog, and let the merge resolve from it.
3. **Snapshot the cluster raw.** Commit what `kubectl get -o json` said,
   as fetch-git commits a tree, and read the snapshot as manifests.
4. **Manifests only.** Leave the cluster alone and require every estate to
   keep rendered manifests in git.

### Decision Outcome

Chosen option: **read names only, from both places.**

Two plugins put the same two lists on a service. `hosts` are the names it
answers on: a Kubernetes Service's name in its short, namespaced, `svc` and
fully qualified forms, and the hosts of the Ingress or HTTPRoute in front of
it. `dials` are the in-cluster names its workload is configured to reach,
read from its containers' `env` and the ConfigMaps they reference and
reduced to the host alone. `extract-k8s` reads them from the YAML under a
repository, one service per step, as one more entry of `portolan-go.wasm`.
`fetch-k8s` reads them from a live cluster through `kubectl`, every
workload of the namespaces named in one fragment, placed into contexts and
services by the recommended labels `app.kubernetes.io/part-of` and
`app.kubernetes.io/name` - or by whichever labels the manifest names
instead, with a namespace-to-context map for workloads that carry none.

The merge resolves an ambiguous route to the one provider that answers on
the host the call names, or on a host the caller dials, and the evidence
says `kubernetes-host` as the basis. A host only decides between providers
of a route; it never conjures one.

What keeps values out is a rule of shape, not a list of words, and it is
the same rule in both readers, held together by one table of cases in
their tests. A `Secret` is never asked of the cluster and never decoded
from a file - nor a `SealedSecret`, an `ExternalSecret`, or any document
carrying `stringData`; a `secretKeyRef` or `secretRef` is not followed.
Every other value is looked at once, in memory, for one question - does it
name a host inside the cluster - and what survives is the hostname: a URL
gives up its scheme, port, path, query and the user and password in front
of the host, and a bare `host[:port]` gives up the port. What is left
qualifies only when the cluster resolves it: a form one of the Services
read answers to, or `<name>.<namespace>.svc`, the one shape no name
outside a cluster has. Warnings name namespaces, kinds, files and
directories, never values; what `kubectl` prints on stderr reaches the
terminal and not the build report.

`fetch-k8s` follows fetch-git's rules for the far end: offline, or when
the cluster cannot be reached, the fragment committed in the repository is
used unchanged with a warning; with no committed copy that is an error,
never a short answer. Nothing but that fragment is written to disk.

#### Consequences

The two readers agree on what a host is, so a `dials` entry from a
repository's manifests and a `hosts` entry from the cluster meet in the
merge like any two fragments. An estate keeps whichever source it has, or
both: the manifests say what should run, the cluster says what does, and
a page that shows both is the diff.

The catalog gains two list fields on a service and one basis on the
evidence, and no entity. An environment, a cluster, an Ingress as a thing
of its own: each is a page nobody has asked for yet, and a decision to be
made when one does.

Option 2 would put every password one misplaced `value` away from a
published page and ask the reader to trust a list of forbidden words.
Option 3 puts the same values on disk under a different name; a committed
snapshot of ConfigMaps is configuration in the repository, whatever it is
called. Option 4 answers the estate that has no manifests in git with
nothing, and even for one that has, what runs is a fact worth having.
