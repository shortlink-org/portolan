---
name: ddd-errors
description: Define and route errors across the layers of a service — sentinels in the domain, markers for validation, wrapping in adapters, pass-through on ports, one mapping at the transport. Use when adding an error, deciding what a caller can act on, wrapping a storage or network failure, or mapping an error to a status, in any language.
---

# Errors

An error is an answer a caller can act on. Each layer adds what it knows and
takes nothing away.

## Rules

**The domain declares one sentinel per answer.** Not found, conflict,
invalid credentials, already taken: each is a named, comparable value at the
package level, prefixed with the package name. A caller tests identity, never
message text.

**Validation raises a marker that wraps the rules.** A value object has one
`ErrInvalid`; the specification's joined failures are inside it. Callers
test the marker; the leaves are for reporting. See
[ddd-specification](../ddd-specification/SKILL.md).

**Failures that must stay indistinguishable are one sentinel.** Wrong
password and unknown address are both `ErrInvalidCredentials`. The
distinction is decided in the domain once, and no layer above may reintroduce
it.

**Conflict has one meaning and one remedy.** The copy in hand is not what is
stored: read again, redo the change, save again. The message says so.

**Adapters translate, then wrap.** A storage error that means a domain thing
becomes the domain sentinel, told apart by constraint name. Anything else is
wrapped with the package and the operation: `user: inserting <id>: <cause>`.
The cause is kept for the log; the sentinel is what the caller tests.

**Ports pass errors through untouched.** A use case returns what its port
returned. Translating it would be the one way to accidentally make a wrong
password distinguishable from an unknown address. The adapter between two
domains in assembly passes through too.

**An error from an external service is not a decision.** Unreachable risk
means nothing is issued and nothing is ended; it is an error, not a verdict.
An unknown value from the other side is an error, not a default.

**A use case declares the errors that are its own.** `ErrBlocked` is
login's: it exists because login decided something. It lives in the use
case's package, not the domain.

**The transport maps in one function per package.** Sentinels and markers
to codes and messages; the same failure cannot get two codes from two
endpoints. Reasons for a validation failure are flattened into a list. Anything
unrecognised is 500 with no detail: the detail stays on this side.

**Nothing swallows silently except by decision.** A cache failure is
swallowed because the database is still there, and the comment says it wants
a metric. A subscriber failure in the in-process bus fails the publisher,
because silent loss is the worst outcome. Both are written down where they
happen.

## Where each error is born

| Kind | Born in | Tested by |
|---|---|---|
| domain sentinel | aggregate package | use case, transport, tests |
| validation marker + rule leaves | value object | transport (marker), reasons list (leaves) |
| use case decision | use case package | transport |
| storage/network wrapped cause | adapter | logs; caller sees the sentinel it maps to, or 500 |

## Checklist

- Every domain answer a caller acts on has a sentinel.
- Value objects: one marker, rules inside it.
- Adapters map by constraint, wrap the rest with package and operation.
- No layer between adapter and transport rewrites an error.
- Transport: one mapping function; 500 leaks nothing.

Language-specific: [references/go.md](references/go.md).
