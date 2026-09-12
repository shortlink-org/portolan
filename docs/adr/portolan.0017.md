# portolan.0017 — Every problem rule is CEL over a row that already carries its joins

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-12
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0017-every-problem-rule-is-cel-over-a-row-that-already-carries-its-joins.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0017-every-problem-rule-is-cel-over-a-row-that-already-carries-its-joins.md)
- **Committed:** Victor Login, 2026-09-12 (`855fbb7`)

### Context and Problem Statement

portolan.0016 gave every problem a rule with a passport, let the manifest
switch and re-grade the shipped rules, and let an estate write rules of its
own in CEL over one subject. It kept the seventeen shipped checks as code,
with this argument: half of them walk the graph - who else writes this
table, who else publishes on this channel, what the provider's copy of an
interface says - and a predicate over one row cannot make that walk.

That left two kinds of rule on one page. A shipped rule showed a passport
and a link to a file; a rule of the estate's own showed its condition. A
reader could not see what a shipped rule checked in the terms the page
had taught them, could not copy one to make a stricter version, and had to
take the passport's prose as the rule. The page said "rules" and meant two
things.

### Decision Drivers

- One kind of rule: what is shipped and what the estate writes should be
  the same shape, read the same way, and be copied from one to the other.
- The argument in 0016 was about where the join happens, not whether a
  rule can be an expression.
- The seventeen checks have tests that hold each to a fixture; whatever
  replaces them must pass the same tests.
- A row should link where it linked, and say what it said.

### Considered Options

1. **Move the joins into the subject rows; write every shipped rule in
   CEL.** A subject's projection computes, once per row, the facts a rule
   would have joined for: a table's `aggregateOwner`, a column's `fkOwner`
   and `foreignFrom`, a channel's `otherPublishers`, a call's `peerKnown`
   and `methodDeclared`, a copy's `differences`. The projection is code
   and says what is; the rule is CEL and says what should not be. Three
   subjects are added for rows the old readers produced that no existing
   subject had - `consumer`, `column`, `copy`, `subscription` - and the
   five readers are deleted, their tests re-pointed at the rules.
2. **Keep the readers, generate their CEL for display.** The page would
   show an expression nobody runs, which is worse than a link to a file.
3. **CEL over the whole catalog.** Rejected in 0016 and still: every rule
   becomes a program over nested lists, slow and unreadable, and the type
   check that catches `event.nme` today cannot follow it.

### Decision Outcome

Option 1.

`rules/builtin.json` carries eighteen rules, each with `over`, `when`,
`message` and `peer` beside its passport - seventeen from the readers and
one, `cross-service-view`, split out of `cross-service-lineage` because a
view reading another service's relation is a row about the view, not about
a column, and a rule is over one subject. The manifest's entries for a
shipped rule are what they were: `enabled`, `severity`, `reason`. A rule of
the estate's own reads the same rows with the same fields, so the shipped
`shared-store` is one line a reader can copy and tighten.

The projections live in `src/lib/problem-subjects.ts` and keep the
readers' judgement calls as fields, not conditions: a projection table is
not a second writer, so `role` is on the row and the rule says
`table.role != 'projection'`; a narrowed copy may omit fields, so
`differences` lists only what it carries and disagrees on. A row's id and
source are what the reader's were - a channel row is its first event when
the service has one on the address and the service otherwise - so every
row leads where it led.

Granularity moved in two places, both accepted. A copied value with
several foreign sources is one row with the sources joined, not one row a
source; a subscriber met by several publishers of different encodings is
one row naming the first. The fixture has neither.

#### Consequences

- `Problem` has `rule` and no `kind`; there is no `Finding`. What was
  `derive.ts`'s `problems()` and the four `*-problems.ts` readers is gone,
  and `driftLines` moved to `deployment-drift.ts`.
- `builtinProblems(catalog, index, ids?)` runs the shipped rules for a
  test; the readers' tests are `rules-*.test.ts` and pass unchanged in
  what they assert.
- Every rule on the Settings page shows its CEL on the row. A shipped
  rule's condition is the one that runs.
- A new check is a projection field, if the row lacks one, and a line in
  `rules/builtin.json`. The test that every shipped rule type-checks over
  its subject and runs clean on the fixture holds it.
- The subject schema is larger, and part of the manifest's contract: a
  field removed from a projection is a manifest rule that stops
  type-checking. Fields are added, not renamed.
