# auth.0006 — A password change ends sessions through a policy, and the domains never import each other

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-08-22
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0006-a-password-change-ends-sessions-through-a-policy.md`

### Context and Problem Statement

A password change should end the sessions issued against the old password.
The rule spans two aggregates that are kept apart on purpose (auth.0002):
`user` publishes the change, `session` holds what has to end.

### Considered Options

1. **The use case does both**: change the password, then end the sessions,
   in one transaction.
2. **A policy**: `user` publishes `PasswordChanged`; a policy in
   `internal/application/policy` hears it and runs the session use case that
   ends what the change invalidates.

### Decision Outcome

Chosen option: **a policy**. `session` never imports `user`, `user` never
imports `session`; the one place that knows both exist is assembly, which
subscribes the policy to the event.

Which sessions end is a domain service in `session`: the one the change was
made from is kept, anything started after the change was issued against the
new credentials and survives, and anything already dead is left alone rather
than ended again with an event that reports nothing.

#### Consequences

- Good: the rule is one policy with one trigger, and the catalog reads it as
  a flow that opens on the bus.
- Bad: the sessions end after the change commits, not with it; the window is
  the relay's latency, and a token can validate once more inside it.
