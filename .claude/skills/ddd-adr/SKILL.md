---
name: ddd-adr
description: Write or update an architecture decision record — when a choice deserves one, the fixed sections, status and scope, and how a decision is superseded rather than edited. Use when a design choice has a rejected alternative that will be asked about again, when reviewing a change that reverses an earlier decision, or when asked where a decision is written down, in any language.
---

# Architecture decision record

An ADR is a decision with the alternative it rejected and the reason. It
exists so the question is answered once, in writing, and the next person to
ask finds the answer instead of reopening it.

## When to write one

- There was a real alternative, and it was rejected for a reason that is not
  obvious from the code.
- The choice has consequences outside one package: a release cadence, a
  drift risk, a boundary between contexts.
- Somebody will ask "why not X" again.

Not for: a naming choice, a library pick with no consequence beyond the
adapter, anything the code comment already answers in one sentence.

## Rules

**Identifier is scope and number.** `org.0001` for the whole estate,
`payments.0004` for a context, `shop.oms.0007` for a service. Numbers are
per scope and never reused.

**Status is one of `proposed`, `accepted`, `superseded`.** A decision is never
edited into a different decision: a new ADR supersedes it and the old one's
status says by which. Both stay.

**Date is when it was decided**, not when the file was last touched.

**Sections are fixed, in this order:**

1. **Context and Problem Statement.** The question, as a question, and what
   makes the obvious answer wrong.
2. **Decision Drivers.** What the answer has to satisfy, as a short list.
3. **Considered Options.** Numbered. Each named the way its proponent would
   name it; the rejected ones are stated fairly.
4. **Decision Outcome.** The chosen option, and the trade-off taken
   deliberately, in a table when there are more than two dimensions. What
   the mitigation is, when a known risk is accepted.
5. **Consequences.** Good and bad, both. A consequence nobody wants is still
   written down.

**The trade-off table names what was given up.** "We take the drift risk
because we can measure it, and we cannot measure the cost of coordinated
releases until it has been paid." The sentence that says why is the whole
point of the record.

**One decision per record.** Two decisions in one file cannot be superseded
separately.

**The code points at the ADR where the decision bites.** A comment on the
vendored proto copy names `org.0001`. The ADR does not repeat the code; the
code does not repeat the reasoning.

## Where

`docs/adr/<nnnn>-<slug>.md` in the repository of the scope: the service's
repo for a service decision, the organisation's for an estate-wide one. An
index lists id, title, status, date and scope.

## Checklist

- A real alternative exists and is stated fairly.
- Id, status, date, scope in the header.
- Five sections, in order; the outcome says what was given up.
- Supersession is a new record, both kept, statuses updated.
- The code comment at the decision point names the ADR.

Template: [references/template.md](references/template.md).
