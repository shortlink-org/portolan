# portolan.0034 — Each catalog profile is its own LikeC4 project

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-30
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0034-each-catalog-profile-is-its-own-likec4-project.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0034-each-catalog-profile-is-its-own-likec4-project.md)

### Context and Problem Statement

A manifest names catalog profiles, and the site shows one of them at a time:
the page loads the active profile's sources when it starts, and every page
after that is about that estate alone. The LikeC4 model was not: it was one
model over every source the site staged, with a pair of views per profile to
narrow it.

Two estates may use the same words. The example estate and the modular
monolith each have a `payments` context; the example estate and CodelyTV's
each have a `bus`; several have a `client`. One model merged each pair into
one element, so the Payments context page of either estate drew the other's
services beside its own, and the one `bus` travelled on NATS and RabbitMQ at
once and could name neither.

### Decision Drivers

- A picture shows the estate the page is about, and nothing of another.
- Catalog ids stay what the catalog says: the app and the generator derive
  every LikeC4 name from them without a table of renames (`src/likec4/ids.ts`).
- The committed `likec4/` covers what the repository's own site can load, as
  it did before.

### Considered Options

1. **A LikeC4 project per profile.** The generator writes
   `likec4/<profile>/` with a `likec4.config.json` naming it, from that
   profile's own merged catalog; `likec4 gen react --project` writes
   `src/likec4/generated/<profile>.jsx`; the page loads the active profile's
   bundle.
2. **One model, colliding ids renamed.** The first profile keeps an id, later
   ones get a prefix. Every field of a catalog that names an id would have to
   be rewritten before the merge, and the app would have to find out which ids
   were renamed for the profile it shows.
3. **Keep the one model, rename brokers only.** Cheap, and leaves `payments`
   and `client` merged.

### Decision Outcome

Option 1.

A profile is drawn when every source it names is also matched by the
manifest's top-level `sources` - the profiles the site can load. In this
repository those are `portolan` and `example`; `portolan dev` stages every
profile's sources at the top level, so there every profile is drawn. A
manifest without profiles keeps its single unnamed model and its `default`
bundle.

### Consequences

- `likec4/` holds one directory per drawn profile; nothing sits at its root.
  `npm run likec4:validate` validates each project by name, since LikeC4 asks
  which project to lay out in a workspace of several.
- `src/likec4/bundle.ts` is the one place the page gets its model from. It
  loads `generated/<profile>.jsx` with a top-level await, falling back to the
  unnamed bundle, so a page downloads one estate's diagrams, not every one.
- Each project still carries its profile's `landscape_<profile>` and
  `containers_<profile>` views beside `landscape` and `containers`, so the
  view ids the app asks for are unchanged.
- A view built from a catalog other than a profile's - a branch draft's flow
  (portolan.0019) - is still laid out as one model from the catalog it is
  given.
