# auth.0012 — Feature slices own their layers and local assembly

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-07
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** [`examples/auth/docs/adr/0012-feature-slices-own-their-layers.md`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/docs/adr/0012-feature-slices-own-their-layers.md)
- **Committed:** Victor Login, 2026-09-07 (`34b9b7c`)

### Context and Problem Statement

The previous tree grouped all domains, all use cases, and all adapters into
global horizontal directories. Changing one capability meant navigating the
whole service, and ownership of policies and dependency wiring was unclear.

### Decision Outcome

The primary boundary is the feature module: `user`, `session`, and `lockout`.
Each module owns `domain`, `application`, `infrastructure`, `integration`, and
`di`. Use cases remain individual slices inside `application`.

Cross-module behaviour belongs to the module whose state it changes. Thus the
password-change reaction is a session policy. Ports are declared by their
consumer; infrastructure adapters may know both sides, while domain and
application packages may not import another module.

Only genuinely service-wide mechanics remain outside the modules:
`platform`, the generated HTTP server, and the composition root.
Wire sets are split by module and by application/infrastructure/HTTP concerns;
the root only composes those sets and shared resources.

The boundaries are executable documentation in `.golangci.yml`, using the
built-in `depguard` linter. Tests are excluded from dependency rules so they
may use concrete adapters. Their setup helpers stay in package-local `_test.go`
files instead of forming another shared package.

#### Consequences

- Good: a capability's behaviour and adapters are discoverable in one subtree.
- Good: module dependencies are visible at adapter and root-assembly seams.
- Good: forbidden inward dependencies fail lint in CI.
- Good: test support remains owned by the package whose behaviour it exercises.
- Bad: there are more small DI and adapter packages.
- Bad: integration-test setup is repeated between packages.
- Neutral: this changes code ownership and imports, not HTTP or business rules.
