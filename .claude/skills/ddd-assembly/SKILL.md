---
name: ddd-assembly
description: Write the assembly (dependency injection, wiring) of a service — the one place that knows every package exists, adapts one domain to another's port, and subscribes policies to events. Use when wiring a new use case, adapter or policy, when two domains need to meet, or when deciding what the assembled app exposes, in any language.
---

# Assembly

Assembly is the only place that knows everything. Every other package
states a need or satisfies one; this is where they are introduced.

## Rules

**One provider per concern.** Clock, config, storage, cache, bus, outbox,
repositories, use cases, transport: each in its own file, each binding
concrete adapters to the ports they satisfy. A reader looking for "where
does the session store come from" opens one file.

**An adapter between two domains lives here.** Login states `Authenticator`;
the user domain has an authenticate use case; the shape between them is a
ten-line type in assembly. This is deliberate: the session packages never
import the user ones, and the knowledge that both exist has one home. The
adapter passes failures through untouched.

**Subscription is assembly, not behaviour.** A policy says what to do with an
event; assembly says that it is listening, as a map from event name to
handler. Putting the subscribe call inside the policy would mean the policy
has to know the bus, and two policies for one topic would compete for the
same messages.

**Every use case is provided, including the ones no endpoint serves.**
Authenticate has no route, but login needs it through the adapter; it is in
the set with a comment saying why.

**What assembly opens, assembly hands back.** The assembled app exposes the
handler that serves, plus the connections it opened (driver, cache) and any
second process it runs (the outbox relay), so whoever built it can close and
run them. A service that quietly has a second process is a service nobody
remembers to shut down.

**Closing is asked, not assumed.** A cache that keeps nothing has nothing to
release; ask whether it closes rather than putting close on the port for the
benefit of one implementation.

**Absence of an external service is a configured client, not a branch in a
use case.** Without a risk address, assembly hands the adapter a permissive
client. The use case is unchanged, and the adapter is still the only code
that reads a verdict.

**Ordering constraints are written where they bite.** A poison queue placed
after retry silently disables retry; the comment on the provider says so,
because the next person to touch it will not see it fail.

## Checklist

- Provider files by concern; each binds adapter to port.
- Cross-domain adapters are here and nowhere else.
- Event name to policy map is here.
- App exposes handler, opened resources, and background processes.
- No use case, adapter or policy imports assembly.

Language-specific: [references/go.md](references/go.md).
