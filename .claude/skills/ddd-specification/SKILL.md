---
name: ddd-specification
description: Express a business rule as a specification — a named, composable predicate that says why it was not satisfied. Use when a value or aggregate has rules that are listed, combined, reported together, or changed independently; when deciding between a specification and a plain conditional; or when adding a rule to an existing policy, in any language.
---

# Specification

A specification is one rule as a value: something that answers "is this
satisfied, and if not, why". Rules become things that can be named, listed,
combined and tested one at a time.

## Rules

**One rule per file, owning its own error.** `MinLength` raises `ErrTooShort`
and nothing else. The file is the rule's whole definition; a reader who wants
to know what "too short" means opens one file and sees the constant, the
error and the check.

**The policy is the composite, and it is the only list.** Which rules
currently apply is written once, as an `And` of the rules in `composite.go`.
Nothing else enumerates them. Adding a rule is adding a file and one line to
the composite.

**`And` collects every failure; it does not stop at the first.** Somebody
filling in a form is told everything that is wrong in one go rather than one
rule per attempt. The errors are joined and the caller can walk them.

**The caller tests the marker, never a rule.** The value object wraps the
joined failures in its own `ErrInvalid`. Callers and the transport test for
that; the leaf errors are for reporting. A new rule reaches the client
without any caller changing.

**Constants that define a rule live with the rule.** `MinLength = 8` is in
`min_length.go`, exported, so a test and a client can name the same number.

**A specification is pure.** It is given a value and answers. No clock, no
store, no context. A rule that needs to look something up is not a
specification; it is a query the use case makes before calling the domain.

**`Or` and `Not` are for the rare rule that reads better composed.** Reach for
them only when the composite reads as the sentence the business says. A
chain of `Not(Or(...))` is a conditional wearing a costume.

## When a specification, when an `if`

| The rule | Write |
|---|---|
| is one of several applied together and reported together | a specification |
| may be switched on or off, or tightened, independently of the code around it | a specification |
| is named in the domain's language ("no display name") | a specification |
| is a single check inside one command with one outcome | an `if` in the command |
| depends on something loaded from a store | a query in the use case, then a command |

The password policy is six specifications because a form shows all six.
"Revoking twice does nothing" is an `if` in `Revoke`, because it is one check
with one outcome and nobody lists it.

## Beyond value objects

The same shape carries an aggregate-level "may this happen": a
specification over the aggregate answering whether a command is allowed
now, listed in the aggregate's package. Use it when there are several such
conditions and a caller needs to report which one refused; otherwise the
command's own `if` is enough.

## Checklist

- `rules/<rule>.go` per rule, each with its own exported error and constants.
- `rules/composite.go` is the only place that lists them, as `And`.
- Value object wraps the joined error in its marker; callers test the marker.
- No I/O inside a specification.
- Composition is `And` unless the business sentence needs `Or`/`Not`.

Language-specific: [references/go.md](references/go.md).
