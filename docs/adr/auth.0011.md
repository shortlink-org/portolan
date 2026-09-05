# auth.0011 — The relay reads every topic and hands it to a bus; policies subscribe to the bus

*Generated from the portolan catalog · commit `4 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0011-the-relay-feeds-a-bus-and-policies-subscribe-to-the-bus.md`

### Context and Problem Statement

Three domains write their events to one outbox, on a topic each. What reads
them back out, and what happens to an event nothing in this service reacts
to?

The first answer was: the relay registers the topics a policy listens to and
dispatches by event name. That reads the `user` topic - `PasswordChanged` has
a policy - and nothing else. A row on `auth_session` or `auth_lockout` was
written in the same transaction as the login or the lock that produced it,
and then never read: pending for good, one more row per login, with a reaper
that only ever clears delivered rows. On the topic that was read,
`UserRegistered` was acknowledged by the dispatcher because nobody was
listed for it, which is the right thing to do with a row and the wrong thing
to have decided in a relay.

The outbox had two audiences on one cursor: the policies inside this
service, and whatever outside it will one day want `UserRegistered` or
`AccountLocked`. Served by one registration per interested topic, the
second audience was invisible, and so was the fact that nothing served it.

### Decision Drivers

- Every topic the outbox is written to must be read. Rows that nobody reads
  are not an event that went unnoticed; they are a table that grows.
- What this service reacts to must be one list in one place, and a domain
  with no subscriber must be visible as such rather than implied by absence.
- The trace must say where an event was consumed and nowhere else: a
  service that acknowledges a row is not consuming the event.
- A broker, when one arrives, should replace one adapter and not the
  wiring.

### Considered Options

1. **Register every topic, keep the dispatch map** — the relay reads all
   three topics; two of the maps are empty.
2. **The relay hands every event to a bus; policies subscribe to the bus** —
   one registration per topic, no names in the relay, the in-process bus
   the tests already use sits on the far side of it.
3. **Two outboxes, or two tables** — one for domain events with policies,
   one for integration events with a broker.

### Decision Outcome

Chosen option: **the relay hands every event to a bus**.

| | rows read | where "who listens" lives | trace says consumed | a broker later |
|---|---|---|---|---|
| every topic, dispatch map | all | the relay's maps | on every read, listed or not | rewrite the relay |
| relay to bus | all | the bus, in assembly | only under a subscriber | swap the bus |
| two outboxes | all | split by table | per table | the domain chooses a table |

The relay does one thing: what the outbox holds, the bus gets. It does not
know event names, so it cannot have an opinion about which ones matter, and
the map of names to policies moves to where the bus is built - the one place
that already had to know both domains exist (auth.0006). An event nothing
listens to leaves the outbox, reaches a bus with no subscriber and is done;
the row is delivered, and the trace shows a publish with no consumer under
it, which is the truth.

What is given up: the split between "domain" and "integration" events is not
in the schema. Both go through the same table, the same relay and the same
bus, and the bus is where a broker will one day fan the second kind out. That
is cheaper than deciding, at publish time and in the domain, which audience a
fact is for - a decision the domain has no business making, and one that a
later subscriber would reverse.

#### Consequences

- Good: no topic can be written and not read; the assembly test publishes
  one event per domain and holds the table at zero pending rows.
- Good: `ProvideBuses` is the whole answer to "what does this service react
  to", and a bus with no subscriber says so in the code rather than in the
  gap of a map.
- Good: the spans follow cart's shape - outbox publish, relay publish, bus
  consume - so the catalog reads auth as consuming `PasswordChanged` and
  nothing else it wrote.
- Bad: an event with no subscriber is acknowledged and gone, not held for a
  broker that does not exist yet. That is deliberate: held rows were the bug.
- Neutral: the in-process bus now takes its topic, for the trace only; the
  tests that bind it straight to the port pass the same string.
