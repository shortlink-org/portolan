---
name: ddd-new-service
description: Start here to build a new service, or a new aggregate inside one, in layers — the order to write things in, and which skill to open at each step. Use when asked to create a service, add a bounded context, or add an aggregate with its use cases end to end, in any language.
---

# New service

Write the domain first and the edges last. Each step produces something the
next step compiles against, and nothing is written before the thing it
depends on exists.

## Before writing

1. **Say what the service owns and what it refuses to own.** Write the
   README's first two sections now: what it does, what it does not do. The
   omissions are deliberate and listed. [ddd-service-layout](../ddd-service-layout/SKILL.md)
2. **Find the aggregates by asking about the lock.** What changes together
   is one aggregate; what changes at a different rate or without the other
   is two, linked by id. Write the domain table in the README: root, value
   objects, events. [ddd-aggregate](../ddd-aggregate/SKILL.md)
3. **Write the rules down with their reasons.** Every rule the README lists
   will become a specification, a command check, or a policy.
4. **Start the glossary.** `GLOSSARY.md` with every noun the README used,
   one sentence each and what it is not. Names in code come from here.
   [ddd-ubiquitous-language](../ddd-ubiquitous-language/SKILL.md)
5. **Record the decisions that had an alternative.** One ADR each, before
   the code that depends on them. [ddd-adr](../ddd-adr/SKILL.md)

## Order of work

| Step | Write | Skill |
|---|---|---|
| 1 | Value objects with their rules and composite | [ddd-value-object](../ddd-value-object/SKILL.md), [ddd-specification](../ddd-specification/SKILL.md) |
| 2 | Events: name, aggregate id, occurred-at, payload without secrets | [ddd-domain-event](../ddd-domain-event/SKILL.md) |
| 3 | Aggregate root: identity, version, constructors and commands returning events, sentinels; the domain README with its state diagram | [ddd-aggregate](../ddd-aggregate/SKILL.md), [ddd-state-machine](../ddd-state-machine/SKILL.md), [ddd-errors](../ddd-errors/SKILL.md) |
| 4 | Ports in the domain: repository with `Save(aggregate, events...)`, publisher | [ddd-aggregate](../ddd-aggregate/SKILL.md) |
| 5 | Domain tests: commands, rules, no I/O | [ddd-testing](../ddd-testing/SKILL.md) |
| 6 | Domain services for decisions across aggregates, pure | [ddd-policy](../ddd-policy/SKILL.md) |
| 7 | Use cases, one package each, with dto and the ports only they need; README with sequence diagram per use case | [ddd-use-case](../ddd-use-case/SKILL.md) |
| 8 | Policies for "when X happened, do Y" across aggregates | [ddd-policy](../ddd-policy/SKILL.md) |
| 9 | Unit of work, repositories with their migrations, outbox publisher, in-process bus | [ddd-unit-of-work](../ddd-unit-of-work/SKILL.md), [ddd-adapters](../ddd-adapters/SKILL.md) |
| 10 | Use case tests on a real store with ports faked inline | [ddd-testing](../ddd-testing/SKILL.md) |
| 11 | Adapters for other services, over a contract copy and generated client | [ddd-adapters](../ddd-adapters/SKILL.md) |
| 12 | Transport from a specification: handlers, one status mapping | [ddd-transport](../ddd-transport/SKILL.md), [ddd-security](../ddd-security/SKILL.md) |
| 13 | Assembly: providers by concern, cross-domain adapters, policy subscriptions, the App | [ddd-assembly](../ddd-assembly/SKILL.md) |
| 14 | Tracing, optional by configuration; a scrubbed recording | [ddd-observability](../ddd-observability/SKILL.md) |
| 15 | Finish the README: rules with reasons, the rule that spans aggregates, HTTP pointer; the LikeC4 model of the context | [ddd-service-layout](../ddd-service-layout/SKILL.md), [ddd-ubiquitous-language](../ddd-ubiquitous-language/references/likec4.md) |

## Adding an aggregate to an existing service

Steps 1 to 10 for the new aggregate, then: a policy if something in the
service reacts to its events, the transport for its use cases, and the
assembly lines for its repository, publisher, use cases and handlers. The
existing aggregates do not change; if one has to import the new one, stop
and reread [ddd-policy](../ddd-policy/SKILL.md).

## Adding a use case to an existing aggregate

A command on the aggregate if the rule is new (step 3), then step 7, its
test (step 10), its endpoint (step 12), and its line in assembly (step 13).
If the use case needs another domain, declare the port in the use case and
adapt in assembly; never import.

## Done when

- Every checklist in the skills above passes.
- `examples/auth` is the reference: when unsure what a step looks like, open
  the matching path there.
- Reviewed with [ddd-review](../ddd-review/SKILL.md).
