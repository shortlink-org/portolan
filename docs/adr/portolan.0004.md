# portolan.0004 — `contexts` and `services` stay the wire format

*Generated from the portolan catalog · commit `11 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-06
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0004-contexts-and-services-stay-the-wire-format.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0004-contexts-and-services-stay-the-wire-format.md)
- **Committed:** Victor Login, 2026-09-06 (`229c1fb`)

### Context and Problem Statement

Portolan began for estates built on domain-driven design: bounded contexts
owning services owning aggregates. A repository that was never laid out that
way still belongs in a catalog: a system with an application in it, a team
with a library, a namespace with a job. Where does it go?

The obvious answer is to rename the keys to `groups` and `components`, migrate
every committed catalog and every extractor in five languages, or to add a
second top-level list beside `contexts`. The first rewrites every fragment
ever committed for a change of word; the second means two of everything
downstream: the site, three generators, the diff, the C4 model.

### Decision Drivers

- An old catalog loads unchanged.
- One model in the site, the generators, the exporters and the C4 model.
- The neutral extractor emits the same node a domain extractor would, so the
  two can fill it side by side.
- The historical meaning stays the default: a fragment that says no kind is a
  bounded context with services in it.

### Considered Options

1. **Keep the keys and add an optional `kind` to both nodes**; absent keeps the
   historical meaning.
2. **Rename to `groups` and `components`** with a migration of every fragment
   and extractor.
3. **A second top-level list**, `systems` with `components`, beside
   `contexts`.

### Decision Outcome

Chosen option: **keep the keys and add an optional `kind`**.

| | old catalogs | downstream | vocabulary |
|---|---|---|---|
| keys stay, `kind` added | load unchanged | one model | two readings of one node |
| keys renamed | migrated | one model | one |
| second list | load unchanged | two of everything | one |

What is given up is one vocabulary in prose: the wire and the code say
context and service, and the README and the setup wizard say group and
component when the kind is neutral. That is the cheaper loss, because a
migration is paid once by everyone and a word is explained once in the
glossary: `GLOSSARY.md` names all four and says which is the term.

#### Consequences

- Good: no fragment is migrated, and every page, view and exporter works for a
  neutral repository on the day.
- Good: `extract-project` and a domain extractor fill the same node, so a
  repository can be catalogued before anyone decides whether it has a domain.
- Bad: the type is called `BoundedContext` and holds a `system`; a reader of
  the Go or TypeScript type has to know about `kind`.
- Neutral: `bounded-context` is also spelled as a kind, for a fragment that
  wants to say so explicitly.
