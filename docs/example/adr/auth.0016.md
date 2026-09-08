# auth.0016 — Password cryptography is an application port

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-07
- **Scope:** [auth.auth](../auth/auth/README.md)
- **Source:** [`examples/auth/docs/adr/0016-password-cryptography-is-an-application-port.md`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/docs/adr/0016-password-cryptography-is-an-application-port.md)
- **Committed:** Victor Login, 2026-09-07 (`34b9b7c`)

### Context and Problem Statement

Password policy is a domain rule, while random salt generation, key derivation,
constant-time comparison, and algorithm upgrades are cryptographic mechanisms.
Keeping both in the value object made the domain choose infrastructure.

### Decision Outcome

The domain retains password policy and an opaque immutable `password.Hash`.
Each user application slice declares only the cryptographic port it consumes:
`register.PasswordHasher` hashes, `check_credentials.PasswordVerifier` verifies,
and `change_password.PasswordHasher` does both. The infrastructure adapter
implements all three while preserving the existing PBKDF2-SHA256 format,
iteration count, random salt size, and constant-time verification.

Registration and password change apply today's policy before hashing.
Authentication never reapplies that policy, so credentials accepted under an
older rule remain usable. Plaintext never enters the aggregate or repository.

#### Consequences

- Good: cryptographic implementation can change behind consumer-owned ports.
- Good: no shared application package pretends to be another feature.
- Good: aggregate state contains only an opaque stored hash.
- Good: persistence remains compatible with existing hashes.
- Deferred: automatic rehash on login needs an explicit business decision
  because it introduces a write and conflict behaviour on the read path.
