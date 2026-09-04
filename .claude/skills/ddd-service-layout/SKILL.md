---
name: ddd-service-layout
description: Lay out a new service, or place a new package in an existing one, so that the domain depends on nothing and every other layer depends inward. Use when starting a service in any language, adding a package and unsure which layer owns it, or reviewing an import that crosses layers.
---

# Service layout

A service is four layers plus shared plumbing. The layers are named by what they
know, and the whole discipline is the direction of the arrows.

```
domain          knows nothing outside itself
application     knows domain
infrastructure  knows domain and application (to satisfy their ports)
assembly        knows everything; the only place that does
pkg             plumbing with no domain in it (unit of work, test harnesses)
```

## Rules

**Domain imports nothing above it.** No database driver, no HTTP, no message
bus, no generated client. What the domain needs from the outside it states as
a port (an interface) and somebody outside hands it an implementation.

**One package per aggregate in the domain.** Each holds the root, its value
objects, its events and its ports. Two aggregates never import each other,
even inside one service: they are linked by identifiers only.

**One package per use case in the application layer.** A use case is one
scenario with one entry point; its input and output are separate types in a
`dto` subpackage so the shape that crosses the edge is visible on its own.

**One package per port in infrastructure**, named after the port it serves:
storage for one aggregate, publishing for one aggregate, the client for one
external service, one transport. Each implements its port and nothing else.

**Two domains know about each other in exactly two places:** a policy in the
application layer (see [ddd-policy](../ddd-policy/SKILL.md)) and assembly (see
[ddd-assembly](../ddd-assembly/SKILL.md)). An import between two domain
packages, or between two use cases of different aggregates, is a defect.

**A service README says what the service owns and what it refuses to own.**
Sections, in order: what it does; what it does not do (and that the
omissions are deliberate); the domain as a table of aggregate, root, value
objects, events; the rules, each with the reason it is a rule. See
`examples/auth/README.md` for the shape.

**The vocabulary is a separate file.** `GLOSSARY.md` beside the README, one
per context; the README does not define terms. See
[ddd-ubiquitous-language](../ddd-ubiquitous-language/SKILL.md).

**Each domain package and each use case package has its own README.** The
domain one lists states and draws the transitions
([ddd-state-machine](../ddd-state-machine/SKILL.md)); the use case one says
what it does, what follows, the answers and the sequence
([ddd-use-case](../ddd-use-case/SKILL.md)). Decisions with a rejected
alternative go to `docs/adr/` ([ddd-adr](../ddd-adr/SKILL.md)).

## Placing a new thing

| It is | It goes in |
|---|---|
| a rule about one aggregate's state | the aggregate |
| a rule about a value on its own | the value object's rules |
| a decision that needs several aggregates but no I/O | a domain service |
| "when X happened, do Y" across aggregates | a policy |
| a scenario a caller asks for | a use case |
| something that talks to a database, bus, other service, or the network | infrastructure |
| the knowledge that two things exist and fit together | assembly |

## Checklist

- No file in the domain imports a driver, a framework, a client, or another aggregate.
- Every use case names exactly the ports it uses, and no more.
- Every infrastructure package names the one port it implements.
- Only policy and assembly mention two domains in one file.

Language-specific layout: [references/go.md](references/go.md).
