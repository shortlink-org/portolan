# Aggregates in Go

Current sources:

- [User](../../../../examples/auth/internal/user/domain/user.go): `Register`
  receives an already-derived `password.Hash`; `ChangePassword` replaces it.
  Credential verification belongs to application, not an aggregate method.
- [Session](../../../../examples/auth/internal/session/domain/session.go):
  lifecycle commands, returned facts, explicit time and cloning.
- [Repository and publisher ports](../../../../examples/auth/internal/user/domain/port.go):
  `Save` accepts the root and domain events for one transactional write.
- [Domain errors](../../../../examples/auth/internal/user/domain/errors.go):
  invariant and repository outcomes; credential refusal is application-owned.

Choose the root's boundary from immediate invariants before copying a type.
Identity/version and a directory shape do not establish a correct aggregate.
The existing root exposes fields; do not treat the example as proof that
mutation bypasses are mechanically prevented.

Repository optimistic version and ordered integration-stream position are
separate unless every committed increment has exactly one stream record.
See [events](../../ddd-domain-event/SKILL.md).
