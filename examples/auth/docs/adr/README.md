# Decision records — auth

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [auth.0001](0001-events-returned-not-buffered.md) | Aggregates return their events; they do not buffer them | accepted | 2026-08-20 |
| [auth.0002](0002-session-is-its-own-aggregate.md) | Session is its own aggregate, linked to User by id | accepted | 2026-08-20 |
| [auth.0003](0003-expiry-publishes-nothing.md) | Session expiry publishes no event | accepted | 2026-08-22 |
| [auth.0004](0004-lockout-is-its-own-aggregate.md) | Lockout is its own aggregate, keyed by user id | accepted | 2026-09-04 |
| [auth.0005](0005-rules-are-specifications-at-construction.md) | Validation lives in constructors, as specifications, and applies when a value is made | accepted | 2026-08-22 |
| [auth.0006](0006-a-password-change-ends-sessions-through-a-policy.md) | A password change ends sessions through a policy, and the domains never import each other | accepted | 2026-08-22 |
| [auth.0007](0007-login-asks-risk-and-a-block-is-a-compromise.md) | Login asks a risk service, and a blocked attempt is treated as a compromise | accepted | 2026-09-04 |
| [auth.0008](0008-a-cache-in-front-of-bytoken-only.md) | A cache in front of the token lookup, and nothing else | accepted | 2026-09-01 |
| [auth.0009](0009-a-lock-answers-like-a-wrong-password.md) | A locked account answers exactly like a wrong password | accepted | 2026-09-04 |
| [auth.0010](0010-a-revocation-is-written-to-the-cache.md) | A revocation is written to the cache, not only dropped from it | accepted | 2026-09-05 |
| [auth.0011](0011-the-relay-feeds-a-bus-and-policies-subscribe-to-the-bus.md) | The relay reads every topic and hands it to a bus; policies subscribe to the bus | accepted | 2026-09-05 |
| [auth.0012](0012-feature-slices-own-their-layers.md) | Feature slices own their layers and local assembly | accepted | 2026-09-07 |
| [auth.0013](0013-domain-events-become-integration-events-at-the-outbox.md) | Domain events become integration events at the transactional outbox boundary | accepted | 2026-09-07 |
| [auth.0014](0014-session-token-lifecycle.md) | Session tokens are opaque, stored, revocable, and expire after 24 hours | accepted | 2026-09-07 |
| [auth.0015](0015-errors-are-owned-and-classified-at-the-edge.md) | Errors are owned by their layer and classified at the edge | accepted | 2026-09-07 |
| [auth.0016](0016-password-cryptography-is-an-application-port.md) | Password cryptography is an application port | accepted | 2026-09-07 |
