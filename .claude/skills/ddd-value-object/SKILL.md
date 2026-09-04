---
name: ddd-value-object
description: Write a value object with its validation rules — an email, a password, a token, a money amount. Use when a primitive carries a rule, when adding or changing a validation rule, or when deciding where a check belongs, in any language.
---

# Value object

A value that exists is a value that passed. Validation lives in the
constructor, so nothing downstream ever checks again and nothing can hold an
invalid one.

## Rules

**Immutable, private fields, one constructor.** The constructor applies the
policy and returns either a value or the reasons it was refused.

**One rule per file, owning its own error.** `min_length`, `has_digit`,
`no_display_name`: each is a specification with a single `IsSatisfiedBy` and a
single error it raises. Adding a rule is adding a file.

**The policy is the composite, and nothing else.** Which rules currently apply
is written in one place, `composite.go`, as an `And` of the rules. `And` joins
every failure rather than stopping at the first, so somebody filling in a form
is told everything that is wrong in one go.

**The package raises one marker error that wraps the rule errors.** Callers
test for the marker (`ErrInvalid`) and never for a rule; the transport then
has one arm for every validation rule there will ever be, and a new rule
reaches the client as the same status without anything outside the package
changing.

**The policy governs creation, not presentation.** A password policy applies
when a password is *set*; it is not consulted when one is *checked* or when a
stored hash is *parsed*. Raising the minimum must not lock out everyone who
registered under the old one. Parsing a stored form is reading a fact, not
making one.

**A stored form carries everything needed to read it back.** A hash stores
its algorithm and cost beside the digest, so raising the cost leaves old
hashes verifiable.

**A secret's `String()` is its storage encoding, never a display.** And
comparison of secrets is constant-time: a timing difference tells an attacker
how much of a guess was right.

**Opaque means opaque.** A token carries no claims. Nothing outside its
domain can read anything out of it, and revoking it is a fact in the store,
not a signature waiting to expire.

## Where a check belongs

| The check is about | It goes in |
|---|---|
| the shape of one value | that value's rules |
| the relationship between fields of one aggregate | the aggregate's command |
| uniqueness across aggregates (email taken) | the store, mapped to a domain error |
| whether a presented secret matches | the value object's `Matches`, without the policy |

## Checklist

- Constructor is the only way to get one; fields are not exported.
- `rules/` has one file per rule, each with its own error.
- `composite.go` is the only place that lists which rules apply.
- One marker error wraps the rule errors.
- Parse/check paths do not apply the creation policy.

Language-specific: [references/go.md](references/go.md).
