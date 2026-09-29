# portolan.0033 — A rule carries its examples, and check holds it to them

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-29
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0033-a-rule-carries-its-examples-and-check-holds-it-to-them.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0033-a-rule-carries-its-examples-and-check-holds-it-to-them.md)
- **Committed:** Victor Login, 2026-09-30 (`9f80c56`)

### Context and Problem Statement

A rule of the estate's own is one CEL condition over one subject
(portolan.0016, portolan.0017). The editor ran it over the catalog as it was
typed and showed the first rows it matched, which answers "what does it
match today". It did not answer "does it say what I meant", and nothing
kept the answer once the rule was saved: a later edit that widened a regular
expression, or a catalog that stopped carrying the row that motivated the
rule, changed what the rule meant without anyone being told.

The rule page now lists every row of the subject, matched or not, and shows
for an opened row which field decided it. That is the moment an author knows
the rule is right about a row - and the moment to write that down.

### Decision Drivers

- The claim "this row should match, that one should not" belongs to the
  rule, next to its condition, in the file the rule lives in.
- The page and `check` must agree about an example, so they run the same
  function.
- portolan.json stays readable: an example must not copy a whole row.
- A shipped rule is not the estate's to change.

### Considered Options

1. **Examples on the rule's manifest entry.** `problemRules[].examples` is a
   list of `{ name, expect: row | none, row, estate? }`. `row` holds only the
   fields the condition reads, plus the id; every other field is its zero
   value. `estate` holds the estate lists the condition reads, when it reads
   any. The manifest check runs each example after the expressions
   type-check and fails, naming the example, when the rule disagrees.
2. **Examples as files beside the manifest.** Tests in their own files keep
   the manifest short, but split a rule across two places and need a loader,
   a naming convention and a second write path from the page.
3. **Snapshot the rule's matches.** Store the ids a rule matched when it was
   saved and report any change. It catches every drift and explains none:
   the catalog changes daily, and a snapshot cannot tell a wrong rule from a
   new service.

### Decision Outcome

Option 1.

An example is kept from the rule page - open a row, keep it as an example
that should or should not match - or written by hand. `exampleMatches` in
`problem-rules-cel.mjs` fills the missing fields, checks the written ones
against the subject's schema, and runs the condition; the page and
`problemRuleProblems` both call it. A shipped rule's entry may not carry
examples, like any other field of a rule's body.

### Consequences

- Save is refused while an example disagrees with the rule: the server
  writes through the same check. The page says which example and offers to
  remove it.
- An example is evaluated with zero values for the fields it leaves out, so
  a condition that reads a field the example did not keep sees `""`, `0`,
  `false` or `[]`. Keeping an example again after the condition starts
  reading a new field is the author's step.
- A field removed from a subject's projection now also breaks the examples
  that name it, in the same way it breaks the expressions (portolan.0017).
- An example does not depend on the catalog: it is about the rule, not the
  estate, and gives the same answer on the page, in `check` and in CI.
