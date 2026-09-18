# portolan.0030 — Two changes to one entity conflict only when they touch the same thing

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-17
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0030-two-changes-to-one-entity-conflict-only-when-they-touch-the-same-thing.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0030-two-changes-to-one-entity-conflict-only-when-they-touch-the-same-thing.md)
- **Committed:** Victor Login, 2026-09-17 (`5988fd2`)

### Context and Problem Statement

A draft is compared from the commit the branch was cut at, and laid over main
as it is now (portolan.0019). When main has moved the same entity since that
commit, the entity was called a conflict and both versions were shown in red.

On a real estate that is mostly wrong. A service gains calls all the time: a
branch adds two callbacks to another service while main, in the meantime,
gained four calls to a third. Nothing is in dispute - the two changes are in
one entity because a service is one entity, not because they are about the
same thing - and a reader who is told "conflict" has to read both columns to
find out there was nothing to resolve. Said often enough, the word stops
meaning anything, and the conflict that does matter is read past.

### Decision Drivers

- The word conflict has to keep its meaning: something a person must decide.
- What main did since the base is worth showing either way; only its severity
  is in question.
- The rule must be computed from what the catalog already knows, without
  asking an extractor for a diff of its own.

### Considered Options

- Keep every entity both sides moved as a conflict, and soften the wording.
- Compare the two versions field by field, generically, over the whole entity.
- Compare the changes the two sides made, by what each change is about.

### Decision Outcome

Chosen: compare what each side's changes are about.

Every line a draft shows - a step relabelled, a field retyped, a call added, a
method removed - is produced with a subject: the step's id at the base, the
field's name, the call's id, the method's key. The branch's changes and main's
changes are both computed against the same base, so their subjects are
comparable.

A subject that appears on both sides is a conflict: one step relabelled two
ways, one field given two types, one call added here and removed there. No
shared subject is `grown` - both sides moved the entity, neither touched what
the other did - and it is shown in the neutral tone, with both columns, as
"also on main".

An entity main removed while the branch changed it, and one the branch adds
that main has added differently, stay conflicts: there is no pair of changes
to compare, and the two versions are the whole disagreement.

#### Consequences

- Good: a conflict is again something to act on, and the estate's ordinary
  parallel growth reads as what it is.
- Good: what main did since the base is still shown for both, so nothing is
  hidden by the softer grading.
- Bad: two changes about the same thing under different names - a call whose
  id changed and a call added - read as parallel growth rather than a
  conflict. The subject is the catalog's identity for the change, and where
  the catalog cannot tell, neither can this.
- Neutral: the states a draft's entity can be in are now five, and a page that
  files entities by state has one more column.
