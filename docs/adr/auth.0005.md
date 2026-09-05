# auth.0005 — Validation lives in constructors, as specifications, and applies when a value is made

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-08-22
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0005-rules-are-specifications-at-construction.md`

### Context and Problem Statement

An email address, a password and a token each have rules. Where do the rules
live, and when do they apply? A rule checked in a handler is skipped by the
next caller; a rule checked on every read locks out everyone who registered
before it was tightened.

### Decision Outcome

A value object's constructor is the only way to get one, so a value that
exists is a value that passed. Each rule is a specification in a `rules/`
package next to the value it governs, and the composite in that package is the
policy: which rules currently apply.

The password policy applies when a password is *created*, never when one is
checked. Raising the minimum must not lock out everyone who registered under
the old one, whose stored hash is still perfectly good.

#### Consequences

- Good: a use case never validates; it takes values, and the values are valid.
- Good: a rule is one file with one name, and the policy is a list a reader
  can see.
- Bad: tightening a rule changes what new users can do and nothing for old
  ones; if the old ones are the problem, that is a migration, not a rule.
