# Policies in Go

Read the current sources instead of recreating the former global policy package:

- [Pure credential-change decision](../../../../examples/auth/internal/session/domain/services/credential_change.go):
  occurrence time selects sessions older than the change; explicit current time
  checks whether a session is still live.
- [Receiving use case](../../../../examples/auth/internal/session/application/end_after_credential_change/usecase.go):
  owns repository operations and retry semantics.
- [Integration policy](../../../../examples/auth/internal/session/infrastructure/messaging/policy/revoke_sessions_on_password_change.go):
  consumes user integration events and calls an injected session operation.
- [Policy tests](../../../../examples/auth/internal/session/infrastructure/messaging/policy/revoke_sessions_on_password_change_test.go):
  local mocks, no application database harness.
- [Local policy set](../../../../examples/auth/internal/session/di/policy.go) and
  [bus subscriptions](../../../../examples/auth/internal/di/provider/bus.go).

The policy belongs to session because session state changes. It does not import
user aggregate event types. A durable multi-step workflow uses
[ddd-process-manager](../../ddd-process-manager/SKILL.md), not a chain of hidden
repository operations inside the policy.
