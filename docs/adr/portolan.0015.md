# portolan.0015 — A rule on a field is read into the catalog, in one vocabulary

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-12
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0015-a-rule-on-a-field-is-read-into-the-catalog-in-one-vocabulary.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0015-a-rule-on-a-field-is-read-into-the-catalog-in-one-vocabulary.md)
- **Committed:** Victor Login, 2026-09-12 (`58731ce`)

### Context and Problem Statement

A schema says more about a field than its type. A proto carries
Protovalidate options - `(buf.validate.field).string.min_len = 1`,
`required = true`, an `in` list on a currency - and an OpenAPI document
carries the same facts as JSON Schema keywords: `minLength`, `required`,
`pattern`. These are the first things a caller wants to know after the
type, and the catalog dropped them. `extract-proto` read past an aggregate
option and left a note saying so; `extract-openapi` kept only whether a
field was required, and kept it by writing "Optional." in front of the
description, where it was text rather than a fact.

EventCatalog's protobuf viewer (event-catalog/eventcatalog#2878) started
showing Protovalidate rules and custom options by parsing the raw `.proto`
in the browser. portolan does not hold raw schemas on the page: an
extractor reads a source into a fragment, and the page renders the model.
So the question is where a rule lives in the model, and in whose words.

### Decision Drivers

- The model is one for every source (portolan.0001): a page must not know
  whether a field came from a proto or an OpenAPI document to show what
  it must satisfy.
- What a reader compares against is the source: a bound must be shown as
  it was written, and a 64-bit bound must not pass through a float.
- A custom option the catalog has no words for is still a fact about the
  field; hiding it is how a reader ends up in the raw file.
- Regenerating from the same sources must change no byte (portolan.0010).

### Considered Options

1. **Rules on the field, in the catalog's own vocabulary.** A field gains
   `required` and a list of `{name, value}` rules; each extractor maps its
   source's spelling to one set of names.
2. **Rules on the field, spelled as the source spells them.** The same
   list, with `minLength` from OpenAPI and `min_len` from Protovalidate.
3. **Parse the source on the page.** Keep the raw schema in the fragment
   and read the options in the browser, as EventCatalog does.
4. **Leave rules in the documentation.** Extractors fold a rule into the
   field's doc text, as `extract-openapi` did with "Optional.".

### Decision Outcome

Chosen option: **rules on the field, in the catalog's own vocabulary.**

A field carries `required` when the source says the field must be sent -
a Protovalidate `required`, a name in a JSON Schema `required` list - and
nothing when the source does not say, since in proto3 and OpenAPI alike
that means it may be left out. It carries `rules`, in the order the source
wrote them, each a name and the bound as text: `min_len`, `max_len`,
`len`, `pattern`, `prefix`, `suffix`, `contains`, `not_contains`,
`format`, `gt`, `gte`, `lt`, `lte`, `const`, `in`, `not_in`,
`multiple_of`, `min_items`, `max_items`, `unique`, `min_pairs`,
`max_pairs`, `defined_only`, `lt_now`, `gt_now`, `cel`. A rule on what a
list holds is prefixed `items.`; on a map's keys or values, `keys.` or
`values.`.

`extract-proto` reads every field option, one per leaf of an aggregate
body, and maps `(buf.validate.field)` onto that vocabulary: the type
segment of the path is dropped, since the field's type is already known;
a well-known string shape spelled as a bool - `email = true` - becomes
`format email`; `ignore`, `example` and a CEL rule's id and message say
how a rule is checked, not what it is, and are not rules. Any other
custom option - `(acme.pii) = true` - is kept under the name the source
gave it, so a reader sees that the field is annotated rather than
finding out in the raw file. Protobuf's own options - `deprecated`,
`json_name`, `packed` - are the wire's, not rules.

`extract-openapi` maps the validation keywords onto the same names and
sets `required` from the list instead of prefixing the description; a
`$ref` property carries the target's keywords, and an array's `items` one
level down. `format` and `enum` stay in the type, where they already were.

The page shows each rule as a short mark beside the type - "≥ 1 chars",
"one of USD, EUR", "uuid" - and keeps the spelling for the tooltip. The
markdown site adds a Rules column to a field table when any field has
one.

#### Consequences

A caller reading an event or a request sees what must be sent and what a
value must satisfy, from either source, in one form. The Go mirror gains
a type and two fields; `extract-proto` stops noting aggregate options it
now reads.

A field's `required` is a flag only when true; the "Optional." prefix is
gone from OpenAPI descriptions, and a reader who wants the negative reads
the absence, as they would in the document.

Option 2 makes the page carry a synonym table, and a third source a third
column of it. Option 3 keeps rules out of the model, where a check cannot
see them and the markdown site cannot print them, and puts a proto parser
on the page. Option 4 is what was there: a fact as text, invisible to
anything that is not a reader.

What the vocabulary does not yet carry is left as it came: a rule name
the page has no words for is shown spelled as the fragment has it. Java's
validation annotations, Django's `max_length` and Laravel's rules are the
next sources to map, onto these names.
