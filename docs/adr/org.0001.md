# org.0001 — Client proto copies live in the consumer's infrastructure layer

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2025-03-11
- **Scope:** org
- **Source:** `data/adr/0001-client-protos-in-consumer-infrastructure.md`

### Context and Problem Statement

When `shop.oms` calls `payments.v1.Payments/Authorize`, it needs the payments
`.proto`. Where does that file come from at build time?

A shared schema repository consumed by every service is the obvious answer, and
it is the one that couples every release to every other release: a change to a
message nobody in `shop` uses still forces `shop` to bump, regenerate and
retest.

### Decision Drivers

- A team must be able to release without waiting on another team's schema bump.
- The boundary between contexts should be explicit in the code, not implicit in
  a shared package.
- Drift between a producer's schema and a consumer's copy must be **detectable**,
  not merely hoped against.

### Considered Options

1. **A vendored copy of the producer's `.proto` under the consumer's
   `internal/infrastructure/<peer>/`**, an anti-corruption layer in the DDD
   sense: the copy is the consumer's translation boundary.
2. **A shared schema repo** published as one versioned artifact for everyone.
3. **Runtime reflection** — resolve descriptors from the server at startup.

### Decision Outcome

Chosen option: **vendored copies in the consumer's infrastructure layer**.

This is the ACL trade-off taken deliberately:

| | compile-time independence | drift risk |
|---|---|---|
| vendored copy | full — a consumer builds and ships alone | real — the copy can fall behind |
| shared repo | none — every bump is everyone's bump | none |
| reflection | full | moved to runtime, where it fails in production instead of in CI |

We take the drift risk because we can *measure* it, and we cannot measure the
cost of coordinated releases until it has already been paid.

The mitigation is mechanical: **the catalog merge compares descriptors.** Each
producer publishes the descriptor set for the services it provides; each
consumer's vendored copy is parsed at catalog build time; a field, method or
enum value that differs between the two is reported against the consuming
service and shows on its page as an unresolved call rather than silently
compiling.

#### Consequences

- Good: `shop` and `delivery` release on their own cadence.
- Good: the copy is a real boundary — a consumer may narrow a message to the
  fields it actually uses, and that narrowing is visible in review.
- Bad: the same `.proto` exists in several repositories. Someone reading two of
  them may reasonably wonder which is authoritative. The producer's is; the
  header comment on every vendored copy says so.
- Bad: drift is caught at catalog build, which is after merge. It is not caught
  at compile time, and it never will be.

## Relates to

- **Services:** [shop.oms](../shop/oms/README.md), [delivery.core](../delivery/core/README.md)
