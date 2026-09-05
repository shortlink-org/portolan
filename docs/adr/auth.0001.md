# auth.0001 — Aggregates return their events; they do not buffer them

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-08-20
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0001-events-returned-not-buffered.md`

### Context and Problem Statement

A command on an aggregate produces a fact: `Register` produces
`UserRegistered`, `Revoke` produces `SessionEnded`. Where does that fact go
between the command running and the change being committed?

The common answer is a list on the aggregate that the repository drains
after saving. It is also the answer that gives the aggregate hidden state and
a dependency on the word "committed".

### Decision Drivers

- What a command did must be visible where it is called.
- Storing a change and publishing its fact must be impossible to do apart.
- The domain must not know that transactions exist.

### Considered Options

1. **Return the event from the command**, alongside the aggregate or the
   error, and hand it to `Save` as an argument.
2. **Buffer events on the aggregate**; the repository reads and clears the
   buffer after writing.
3. **Publish from the command** through a port the aggregate holds.

### Decision Outcome

Chosen option: **return the event**.

| | visible in the signature | store and publish inseparable | domain knows about commit |
|---|---|---|---|
| return | yes | yes: `Save(aggregate, events...)` | no |
| buffer | no | only if every repository remembers to drain | yes: the buffer must be cleared on commit |
| publish from command | no | no: publish can succeed and save fail | yes |

A buffered event is state that is not part of the aggregate's meaning and
has to be reasoned about on every path, including the one where the save
failed. Returned, the fact is a value like any other: the caller sees it,
tests assert on it, and there is no way to store without offering it.

#### Consequences

- Good: every command's signature says whether it produces a fact.
- Good: a refused command returns no event, so "announces nothing" is
  visible rather than a cleared buffer.
- Bad: a command that produces several facts returns several values; there
  is no such command here today.
- Neutral: `Revoke` returns `(event, bool)` rather than `(event, error)`
  because the second call is not a failure.
