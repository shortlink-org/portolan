---
name: ddd-errors
description: Own and classify errors at domain, application, adapter and transport boundaries. Use when adding refusals, mapping peer errors to a consumer port, or preserving causes without leaking protocol or security details.
---

# Errors

Follow the target's accepted error ownership. In auth, `auth.0015` assigns
invariant, lifecycle, repository-contract and optimistic-conflict sentinels to
the domain, orchestration outcomes to application, and HTTP semantics to the edge.

## Rules

- Declare one comparable error per outcome the owning layer distinguishes.
  Use `errors.Is`/`errors.As` in Go, never message comparisons.
- Value-object validation wraps rule failures with its marker. Report only
  supported public reasons at the edge.
- Application owns credential refusal and blocked-login outcomes. Unknown
  user, wrong password and locked account are deliberately classified into
  one non-enumerating credential refusal by the credential-checking use case.
- A port's errors belong to its consumer contract. A cross-module adapter
  maps peer outcomes where the contracts differ, preserving operational causes
  where useful. Preserve an already-agreed refusal unchanged when the contract
  permits it, as auth's identity adapter does; never reveal hidden distinctions.
- Within a contract, preserve error classification when adding context with
  `%w`. Map known storage constraints to the correct domain outcome; wrap
  unexpected errors with operation context. External unavailability or an
  unknown verdict is an error, not a business decision.
- HTTP adapters are the sole mapping to status and public text. Equivalent
  credential failures remain equivalent; unrecognised failures return a fixed
  500 without internal detail. Test each new public mapping.

Optimistic conflict means the loaded version is stale. Re-read and re-evaluate
only where retrying preserves intent; a background idempotent loop may retry
locally with a bound, while an interactive conflicting edit may return 409.

## Checklist

- Errors belong to the layer that owns the outcome.
- Foreign failures conform to the consuming port's contract; translation is explicit where needed.
- Classification and causes survive wrapping; security-equivalent outcomes stay equivalent.
- Only the transport chooses status codes and public messages.

Current Go reference: [references/go.md](references/go.md).
