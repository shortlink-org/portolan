---
name: ddd-review
description: Review a service, a package, or a diff against the layered-DDD rules — dependency direction, aggregate boundaries, events, use cases, adapters, transport, errors, security, tests. Use when asked to review a service for DDD compliance, to check a change before merge, or to find where a codebase departs from these rules, in any language.
---

# Review

Walk the layers from the inside out. For each finding, name the rule, the
file, and what the alternative costs, in that order; a finding without a
reason is a preference.

## Dependency direction

- Domain imports no driver, framework, client, or other aggregate.
- Use cases import their own domain only; a need from another domain is an interface declared in the use case.
- Only policy and assembly mention two domains in one file.
- No package imports assembly.

## Language and records

- `GLOSSARY.md` exists; every package, type, command, event and route name is in it; no synonyms, no double meanings.
- Foreign enums and names mapped in one adapter, never seen inward.
- Decisions with a rejected alternative have an ADR; supersession is a new record; the code names the ADR where it bites.
- LikeC4 model spells names as the glossary does; called-but-unmodelled peers are `unknown`, not missing.

## Aggregate

- Root has identity separate from natural keys, and a version.
- Every rule about state is in a command on the root; no setter bypasses one.
- Commands return events; nothing buffers them; idempotent commands report "did nothing" and return no event.
- Repositories hand out copies; `Save` takes events.
- One sentinel per answer a caller can act on; indistinguishable failures share one.
- Domain README lists states and draws transitions; every arrow has an event, time-derived states have none; commands have no side effects; terminal states stay terminal.

## Value objects and specifications

- Constructor is the only way in; fields private; immutable.
- One rule per file with its own error; `composite.go` is the only list; `And` joins failures.
- One marker error wraps the rules; callers test the marker.
- Creation policy is not applied on parse or check.
- No I/O in a specification.

## Events

- Past tense; name, aggregate id, occurred-at in the domain.
- Names are shared constants.
- No secrets; opaque ids stay opaque; reasons are closed sets.
- Nothing published where nothing happened.

## Use cases

- One package each; `dto` in and out; struct holds exactly its ports plus clock and id generator.
- Order of steps stated and justified.
- Refusals from ports pass through; external failure is not a decision.
- Output carries nothing a client could build on by mistake.
- README: what it does / what follows / answers / sequence as a link to the derived flow page; a hand-drawn diagram only where no tooling derives one, and then naming ports, not adapters.

## Domain services and policies

- Domain service is pure, imports the aggregate, takes time from the event.
- Policy handles one event, ignores the rest, calls a use case, never a repository.
- A rule across aggregates is not a call inside one use case.

## Adapters

- Each implements one port; nothing else exported for a use case to reach for.
- No transaction handling in statements; unit of work re-entrant, one lookup shared by driver, outbox and cache; `Save` writes aggregate and events in one transaction.
- Independent aggregates in a loop: one transaction each, conflict retried per item; two aggregates in one unit only with a stated reason.
- Migrations inside the store package, numbered per aggregate, no cross-aggregate references, no down files.
- Update compares version; zero rows is conflict; storage errors mapped by constraint, rest wrapped with package and operation.
- Cache: same port, hot path only, bypassed in a transaction, failures swallowed with a note, misses not stored, keys prefixed.
- External client: one package knows both sides; unknown enum is an error; the stub is a client, not an adapter.

## Transport

- Server generated from the spec.
- One status function per package; validation is one arm with reasons listed.
- Indistinguishable failures: one code and message; blocked is 401 not 403; 500 leaks nothing.
- Auth dependencies explicit in the handlers that need them.

## Security

- No plaintext secret on a struct, in an event, in a log, in a span.
- Constant-time compare; hash parameters stored with the digest.
- Current password required on change; blocked attempt ends sessions before refusing.
- README lists deliberate omissions.

## Assembly

- Provider per concern; adapter to port bindings there.
- Cross-domain adapters and event-to-policy map live here and nowhere else.
- App exposes handler, opened resources, background processes; close is asked, not assumed.

## Observability

- No-op without configuration.
- Route-template span names; producer and consumer spans per event with its name; context carried across the outbox.
- Committed recording is scrubbed.

## Tests

- Domain tests import no infrastructure; fixed "now".
- Ports faked as function types with helpers named for intent.
- Use cases on a real store with a recording bus; refused paths assert no events.
- Tests named for the rule they pin.

## Reporting

Group findings by layer, most inward first: a domain finding usually
explains several outer ones. Quote the rule from the skill it comes from
and link it. Say what to change, not only what is wrong.
