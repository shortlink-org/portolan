# portolan.0003 — The Go catalog is a mirror held by a round-trip test

- **Status:** accepted
- **Date:** 2026-09-02
- **Scope:** portolan

## Context and Problem Statement

Plugins written in Go need the catalog's shape, and the site written in
TypeScript needs it too. Where is the shape decided, and how do two languages
hold one shape?

The obvious answer is a JSON schema that both are generated from. A generated
type carries no prose, and the prose is where every decision about the shape
lives: why a list is optional in the file and never optional downstream, why a
context's id is its slug. The other obvious answer is two definitions kept in
step by care, which is how two definitions drift.

## Decision Drivers

- One place decides the shape, and the reasoning sits beside the field it is
  about.
- A Go plugin reads a catalog the host has already validated, and does not
  validate again: a second opinion in a second language is how the two drift.
- Drift between the two is a failing test, not a reader's surprise.
- A plugin in a language with no mirror at all still works.

## Considered Options

1. **`src/catalog.ts` is the definition and `catalog/model.go` a hand-written
   mirror**, held to it by a round-trip test over a fixture catalog.
2. **A JSON schema generates both** — one source, two generated types.
3. **Go is the definition and TypeScript is generated** from it.
4. **No Go mirror** — Go plugins read `map[string]any`.

## Decision Outcome

Chosen option: **`src/catalog.ts` is the definition and the Go package is a
mirror**.

| | prose beside the shape | drift | plugin ergonomics |
|---|---|---|---|
| TypeScript decides, Go mirrors | yes, once | a test fails | typed |
| schema generates both | no | none | typed, undocumented |
| Go decides | yes, in Go | a test fails | the site reads a generated type |
| no mirror | yes | none | untyped |

What is given up is typing every field twice by hand, and that a field added
on one side and not the other is a test failure rather than a compile error.
That is the cheaper loss, because the round trip is mechanical and the prose
is not.

### Consequences

- Good: the reasoning about the shape lives in one file, and the Go package
  says on its first line that it decides nothing.
- Good: Rust, Python, Java and TypeScript plugins keep no mirror; they write
  JSON the host validates.
- Bad: the round trip covers what the fixture exercises, so an `omitempty`
  on the Go side and an "optional in the file" on the TypeScript side have to
  be matched by hand.
- Neutral: the mirror is kept honest by the tests that hold generators to the
  catalog too: a field rendered nowhere fails the coverage test.
