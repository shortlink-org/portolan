# auth.0015 — Errors are owned by their layer and classified at the edge

- **Status:** accepted
- **Date:** 2026-09-07
- **Scope:** auth.auth

## Context and Problem Statement

The service needs stable errors for control flow without coupling domain code
to HTTP status codes or exposing storage and security detail to clients.

## Decision Outcome

Domain packages own invariant, lifecycle, repository-contract, and optimistic
conflict sentinels in `errors.go`. Application slices own orchestration outcomes
such as invalid credentials and a risk-blocked login. Adapters wrap causes with
operational context using `%w`; callers classify only with `errors.Is` or
`errors.As`.

HTTP adapters are the sole mapping from those errors to status and public text.
User input validation is 400, uniqueness and optimistic conflicts are 409, and
known user lookup is 404. All credential failures and every invalid-token state
collapse to a non-enumerating 401. Unknown errors are 500 with no internal
detail.

There is deliberately no shared service-wide `apperror` type. Ownership and
`errors.Is` preserve module boundaries; the edge supplies protocol semantics.

### Consequences

- Good: domains remain transport-independent.
- Good: wrapped infrastructure errors retain context and classification.
- Good: authentication responses do not reveal whether an identity or token
  exists.
- Bad: every new public error requires an explicit transport mapping and test.
