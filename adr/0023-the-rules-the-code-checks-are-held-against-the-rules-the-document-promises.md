# portolan.0023 — The rules the code checks are held against the rules the document promises

- **Status:** accepted
- **Date:** 2026-09-16
- **Scope:** portolan

## Context and Problem Statement

Since portolan.0015 a rule on a field arrives in one vocabulary whatever
source it came from: `min_len`, `format uuid`, `in USD, EUR`. `extract-proto`
and `extract-openapi` read them off a contract, `extract-django` off a model,
and `extract-ts` now reads them off the zod schema a handler parses a request
with.

That last one is different in kind. A proto and an OpenAPI document are what a
caller is promised; a zod schema is what the service will actually refuse. A
service that has both has said two things about one field, and the catalog
held them apart: the document's word on the interface's request message, the
code's word on the operation the handler runs. Nothing anywhere said when the
two disagree.

The disagreement is a real defect on both sides of the arrow. `cart`'s
document says `AddItemRequest.sku` is a string; its handler refuses an empty
one. A caller written to the document, generated from it, or tested against
it, gets a 400 nothing documented. The other direction is worse in a quieter
way: a document that promises `maxLength` the handler never checks sends the
value on to something that did not expect it.

## Decision Drivers

- A projection says what is, a rule says what should not be (portolan.0017):
  the comparison belongs on a row, the judgement in CEL, and neither in an
  extractor.
- Nothing about a problem is written into a fragment (portolan.0016), and the
  two sides arrive from two different extractors that first meet at the merge.
  Whatever compares them has to run over the merged catalog.
- Neither side is the authority. The catalog does not know whether the bound
  in the code is the truth the document is behind on, or a check nobody meant
  to keep; a row that named a culprit would be guessing.
- Only what both sides say about the same field can be compared. A route's
  path parameter is in no body message; a field the document carries and this
  handler never parses is another operation's or another layer's.
- The one vocabulary is what makes any of this possible: a source whose rules
  the catalog does not yet map is silent here, not wrong.

## Considered Options

1. **A subject the rule reads: `operation`, carrying the differences, with a
   shipped rule `rules-drift` over it.** The row says which field's rules
   differ and how, in both sides' words; the rule says that a difference is
   worth a reader's time, and the estate can switch it off or re-grade it like
   any other.
2. **Compare at generation and write the drift into a fragment.** A fragment
   would carry a judgement, and the extractor that writes it sees one side of
   the comparison only.
3. **Have the extractor warn.** `extract-ts` reads the schemas and the
   document's operationIds, so it could - but not the document's shapes, which
   `extract-openapi` reads, and a service whose contract is a proto in another
   repository is out of its reach entirely.
4. **Pick a side: generate the document from the schemas, or fail a build
   where they differ.** A good practice, and a decision about one codebase
   rather than something a catalog of many can take. A service that already
   does it has no rows here, which is the point.

## Decision Outcome

Chosen option: **1.**

`operation` joins the subjects a rule may be written over: one row per use
case of an aggregate, with its kind, what exposes it, the fields its handler
checks, the contract and method a caller reads it as, how many fields both
sides name, and `ruleDifferences` - one line per disagreement, in the order
the handler states its fields.

The comparison is over the fields both sides name, and over three things about
each: a rule only the handler has, a rule only the document has, and a rule
both have with different bounds. `required` is compared the same way, since
"must be sent" is the first rule a caller wants. Each line says both words and
names neither as wrong - `sku: the handler checks min_len = 1, the document
says nothing` - and the row's far end is the contract, so the reader can open
what the caller reads.

The shipped rule is a warning: `size(operation.ruleDifferences) > 0`. An
operation whose handler parses nothing has no fields and no rows; so has one
nothing exposes, or one whose method declares no request shape.

#### Consequences

A defect that was in neither half of the catalog - each side correct on its
own, the pair wrong together - is now a row on the Problems page, next to the
service that owns both halves. The example estate shows two of them, both
real: `cart`'s `sku`, and the two fields `mergeBaskets` checks and its
document does not.

The rule grows with the vocabulary rather than with the sources. Laravel's
rules and Java's validation annotations map onto the same names
(portolan.0015); when they do, the same rule holds those services to their
documents with nothing new written.

An operation has no page of its own, so the row lands on the aggregate that
handles it, as the palette's entry for a command already does.

What is not compared is what neither side can be held to: the type, which the
`column-type` and `proto-drift` rules already own where it is a wire claim; a
rule inside a nested schema a field only names; and a field one side names
alone, which is a question about shapes rather than about bounds.
