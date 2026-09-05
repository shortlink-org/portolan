# auth.0007 — Login asks a risk service, and a blocked attempt is treated as a compromise

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-04
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** `examples/auth/docs/adr/0007-login-asks-risk-and-a-block-is-a-compromise.md`

### Context and Problem Statement

A login with the right password can still be one the business does not want
to allow. Somebody other than this service knows that; this service has to ask,
and has to decide what a refusal means.

### Decision Outcome

Login asks `risk.v1.RiskService/Assess` after the credentials are checked and
before a session is issued. The use case declares the need as a port of its
own, `login.Risk`; assembly fills it with an adapter over the generated
client, from a narrowed copy of the contract vendored under
`internal/infrastructure/risk` - the same shape as the Authenticator, so that
the knowledge that another service exists lives in one place, and it is not
the domain. Without `RISK_ADDR` every attempt is allowed, so a laptop needs no
risk service.

A blocked attempt is treated as the account being compromised: whoever is
trying has the right password. Every live session the account has is ended
first - `SessionEnded` with reason `risk-blocked`, one transaction each - and
only then is the attempt refused, with the same `401` as a wrong password. A
`403` would say the account exists and is worth attacking, which is the one
thing the attacker came to learn.

#### Consequences

- Good: a compromised account loses its sessions at the moment the compromise
  is known, without anyone else having to react.
- Bad: no service in the estate provides `risk.v1`; the catalog shows the
  call as unresolved, which is the true state until one does.
