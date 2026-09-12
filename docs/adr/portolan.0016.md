# portolan.0016 — A problem is a rule with a passport, and a new one is written in CEL over one subject

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-12
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0016-a-problem-is-a-rule-with-a-passport-and-a-new-one-is-written-in-cel-over-one-subject.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0016-a-problem-is-a-rule-with-a-passport-and-a-new-one-is-written-in-cel-over-one-subject.md)
- **Committed:** Victor Login, 2026-09-12 (`87e8c1e`)

### Context and Problem Statement

The Problems page was made of seventeen checks written in TypeScript across
five readers. A check had a kind and a severity and nothing else a reader
could hold: no name to refer to it by, no words on what it looked for or
what to do about a row, no way to switch it off for an estate that shares
one database by design, and no way to add one. An estate whose rule was
"every event has a consumer by the end of the quarter" had no place to
write it down where the page would enforce it.

Warnings from the extractors had already been given ids and a CEL policy
in `portolan.json` (`warningPolicies`) - typed, checked when the manifest
is read, evaluated at generation and written into the build report, so a
deployed site receives decisions and not an expression runtime. Problems
are not warnings: they are computed in the browser from the merged catalog
on every load, because the catalog is what they are about and nothing about
them is a fact worth a fragment.

### Decision Drivers

- A rule a reader cannot see is a rule they cannot trust or argue with.
- Switching a check off is a decision about the estate, and belongs in the
  manifest with a reason, next to the other decisions about the estate.
- Half the checks walk the graph - who else writes this table, where a
  column's value came from, which two services publish on one channel. A
  predicate over one row cannot make them.
- The manifest already has CEL, and a second expression language would be
  one too many.
- A rule should run where the reader is, over the catalog they are looking
  at, and the page should say what a rule would produce before it is saved.

### Considered Options

1. **Built-in checks stay code with a passport in a file; new rules are CEL
   over one subject; every rule is applied in the browser.**
   `rules/builtin.json` names each reader's kind with a subject, a severity,
   a title, the words on the row, a description and an action; a test holds
   the file and the readers' kinds equal. `problemRules` in the manifest
   switches or re-grades a built-in rule by id, with a reason, or declares a
   rule of its own: `over` names a subject - service, event, channel, table,
   deployment, call - and `when` and `message` are CEL over a flat, typed
   view of one such row and `estate`, the names the catalog answers to. The
   expressions are type-checked when the manifest is read and again in the
   page, by one module. The Settings page lists every rule with the rows it
   produces, and writes the manifest through the local API after the same
   check.
2. **Rewrite the built-in checks as CEL.** A shared store is "another
   service's access to a table whose store this service owns" - a join over
   two lists the row does not carry. Giving the expression the whole catalog
   makes every rule a program, and a slow one, and the seventeen readers
   already exist and are tested.
3. **Evaluate rules at generation, like `warningPolicies`, into a fragment.**
   Consistent with the rule that a deployed site gets decisions. But the
   readers already run in the browser, a switch on the page would take a
   build to show, and a rule being written could not show what it matches
   until it had been saved and generated. The site would carry both the
   findings and the decisions about them, and the two could disagree.
4. **Rules per browser, in local storage.** Nothing to commit and nothing to
   review; a rule switched off is switched off for one person, and the
   published page still shows the rows the estate agreed to hide.

### Decision Outcome

Option 1.

The readers are unchanged in what they find. What they return is a finding
- kind, severity, ends, words - and the registry turns findings into
problems: a finding whose rule is off is dropped, one whose rule is
re-graded takes the new severity, and the manifest's own rules add their
rows after, each stamped with the rule's id. The Problems page, the
sidebar's badge, the overview and the landing subscribe to the rules in
force, so a switch flipped on the Settings page is visible on the next
render and nothing is rebuilt.

A rule of the manifest's own reads one subject as a flat record - strings,
ints, bools and lists of strings, the fields listed in
`src/lib/problem-rules-cel.mjs` - and `estate`, so `call.peer in
estate.services` is a rule and `event.consumers.exists(c, c in
estate.services)` is one. It does not read the catalog. A check that needs
the graph is a reader in TypeScript with a passport, which is what the
seventeen are, and what the next one will be when a predicate will not do.

The CEL environment is one module, plain JavaScript, imported by the
manifest loader under Node and by the page in the browser, so that a
manifest `gen` accepts is a manifest the page runs, and the error under the
text box is the error `gen` prints. The evaluator is in the bundle now,
which is the cost of option 1 over option 3, and is accepted: the page
already computes the problems it shows, and the expressions it runs are
the estate's own, checked twice.

#### Consequences

- `Problem` carries `rule`; readers return `Finding`. The Problems page
  filters by rule, and every row's words link to the rule on the Settings
  page.
- `rules/builtin.json` is part of the package. A new reader adds a kind to
  `PROBLEM_KINDS` and a passport to the file, or the test fails.
- `problemRules` is in the schema in two shapes under one `id`: a built-in
  id may carry `enabled`, `severity` and `reason` and nothing else; any
  other id must carry `over`, `when`, `message` and `title`. A disabled
  built-in rule needs a reason.
- The local API reads and writes `problemRules` with a revision of the
  file, through the same `writeManifest` every other local change uses, so
  the file keeps its shape and a stale page cannot overwrite a hand edit.
- A deployed site carries the CEL evaluator and the manifest's rules, and
  applies them on load. `warningPolicies` are unchanged: they are about the
  build, and the build is where they run.
- A rule that fails on one row - a type the check did not foresee - fails as
  a rule: its rows are absent and the page says so, rather than showing a
  list that is short by an unknown number.
