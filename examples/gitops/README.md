# gitops — what deploys the example estate

The Argo CD side of the example estate: which services run in which
environment, at which tag, with how many replicas. The services' own
manifests stay beside their code (`examples/shop/*/deploy/k8s`, the bases);
this tree holds only what an environment adds to them, and what tells Argo
CD to read it. In a real estate this is a repository of its own, next to the
service repositories; here it lives in the same tree so the bases can be
reached by a relative path.

```
examples/gitops/
├── bootstrap/
│   ├── root.yaml            the one Application applied by hand: everything else follows from it
│   └── projects/            one AppProject per boundary - where its Applications may deploy from and to
├── appsets/
│   ├── shop.yaml            one Application per service per environment, found in envs/*/shop/*
│   └── platform.yaml        the add-ons the cluster runs from Helm registries, values under platform/
├── envs/
│   ├── prod/
│   │   ├── cluster.yaml     where prod is: the cluster, as the ApplicationSet reads it
│   │   └── shop/<service>/  the overlay: base + tag + replicas + what prod says differently
│   └── staging/
└── platform/<add-on>/values.yaml
```

## Three rules

**Environments are folders, not branches.** `envs/staging` and `envs/prod`
differ in a tag, a replica count and a ConfigMap value; a branch per
environment would make each of those a cherry-pick. Promotion is a pull
request that copies a line from one folder to the other, and the diff is
the review.

**Nothing is written twice.** An overlay names the base by path and states
only what the environment changes. A service that gains a port gains it in
its own repository, and every environment picks it up on the next sync.

**Argo CD finds the Applications, nobody writes them.** `appsets/shop.yaml`
walks `envs/*/cluster.yaml` for the environments and `envs/<env>/shop/*`
for what is deployed in each, and makes one Application per pair, named
`shop-<service>-<env>`. Adding a service to staging is creating a
directory. Every Application it makes carries the labels
`app.kubernetes.io/part-of` and `app.kubernetes.io/name`, which is how
portolan's `fetch-argocd` places it on a service without guessing from a
path.

## Bootstrap

```bash
kubectl apply -f examples/gitops/bootstrap/root.yaml
```

`root` deploys the AppProjects and the ApplicationSets; the ApplicationSets
deploy the rest. Nothing else is applied by hand.

## What is deliberately not here

- Secrets. `pricing-database` in the base is a placeholder; a real estate
  seals it (SOPS, Sealed Secrets, External Secrets) and this tree never
  holds a value.
- Promotion tooling. A pull request is enough at this size; Kargo is the
  next step when an estate wants verification gates between environments.
- The cluster's own state. What is synced and healthy lives in Argo CD;
  portolan reads the Applications' revisions and images into a snapshot
  (`examples/argocd/`) and links to Argo CD for the rest.

## Checking it

`scripts/gitops-example.test.mjs` renders every overlay with `kustomize
build` (or `kubectl kustomize`) and checks that what each environment says
is what comes out, and that the snapshot in `examples/argocd/` names an
Application for every overlay here.
