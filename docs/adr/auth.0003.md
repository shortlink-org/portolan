# auth.0003 — Session expiry publishes no event

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-08-22
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0003-expiry-publishes-nothing.md`

### Context and Problem Statement

A session stops being usable at `ExpiresAt`. `SessionEnded` exists for
sessions that are ended. Should expiry publish one too, so that consumers
have one event to watch for "this session is over"?

### Decision Drivers

- An event is a fact about something that happened in the domain.
- Nothing should be published that no code decided.
- Consumers must be able to know when a session stops working.

### Considered Options

1. **No event.** `SessionStarted` carries the expiry; consumers read it.
2. **A sweep** that finds expired sessions and publishes `SessionEnded`
   with reason `expired`.
3. **Publish on first refusal**, when an expired token is presented.

### Decision Outcome

Chosen option: **no event**.

| | who decided | when it fires | can be missed |
|---|---|---|---|
| no event | nobody; time passed | never | no: the expiry was in `SessionStarted` |
| sweep | whichever sweep noticed first | minutes late, or never for a dead sweep | yes |
| on refusal | a client that happened to try | only if somebody presents the token | yes |

When a session runs out of time no code runs and nobody decides anything.
An event there would be an invention with a timestamp chosen by whoever
noticed. Every consumer already holds the expiry from the start event and
can do its own arithmetic.

#### Consequences

- Good: `Reason` has no `expired` value, so a client is never told "your
  session expired" about a session that was revoked.
- Good: no sweep to run, monitor, or reason about.
- Bad: a consumer that wants a notification at expiry has to schedule it
  itself from `SessionStarted`.
- Neutral: `Validate` refuses an expired token when it is presented; that is
  a read, not a transition.
