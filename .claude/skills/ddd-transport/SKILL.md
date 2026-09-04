---
name: ddd-transport
description: Write the HTTP or RPC edge of a service — handlers that call use cases, and the one place that maps domain errors to status codes. Use when adding an endpoint, deciding a status code, reporting validation failures, or when an error must not reveal something, in any language.
---

# Transport

A handler collects a DTO, calls a use case, and translates the answer. It
decides nothing else.

## Rules

**The contract is generated from a specification, not written by hand.**
The OpenAPI (or proto) file is the one place routes, shapes and status codes
live; the server interface is generated from it, so it cannot drift, and the
README does not repeat it.

**Status codes are decided in one function per package.** The same failure
cannot come back as 401 from one endpoint and 403 from the next. Handlers
call it; nobody else picks a code.

**One arm for every validation rule there will ever be.** Test for the value
object's marker error, answer 400, and list the leaf reasons. A new rule in
the domain reaches the caller without anything at the edge changing.

**Failures that must stay indistinguishable stay so at the edge.** Every
reason a token can fail is one 401. A wrong current password on
change-password gets exactly the answer a failed login gets, so the endpoint
is not a cheaper way to test guesses than the front door. A blocked login is
the same 401 as a wrong password: a 403 would say the account exists and is
worth attacking.

**The same domain error can map to different codes in different packages,
for a reason.** Not-found is 404 when the caller already knows the id (a
lookup by id discloses nothing) and 401 when it is a token (no such token and
expired token must be one answer). Write the reason down where the mapping is.

**Conflict is 409 and the caller's move.** Read again, redo, resend. Nothing
on this side can resolve it, because only the caller knows what they meant.

**Anything unrecognised is 500 with no detail.** The detail stays on this
side; the caller gets a code it can act on and nothing to probe.

**Authentication is visible, not hidden.** If one endpoint needs to know who
is calling, it resolves the token itself through the validate use case, with
the dependency in its constructor. A reader can see which handlers
authenticate and which do not. Middleware is for what every route needs.

**A malformed header is an unknown credential**, not a 400: it gets the
answer an unknown token gets.

## Checklist

- Server interface generated from the spec; handlers implement it.
- One `status(err)` per package; handlers do not pick codes.
- Validation: one arm on the marker, reasons flattened.
- Indistinguishable failures: one code, one message.
- 500 carries nothing from the error.
- Auth dependencies explicit in the handler that needs them.

Language-specific: [references/go.md](references/go.md).
