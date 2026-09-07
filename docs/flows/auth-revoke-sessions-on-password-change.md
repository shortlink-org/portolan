# Revoke sessions on password change

*Generated from the portolan catalog · commit `10 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.auth-revoke-sessions-on-password-change`
- **Owner:** [auth](../auth/README.md)
- **Source:** [`examples/auth/internal/application/policy/revoke_sessions_on_password_change.go`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/policy/revoke_sessions_on_password_change.go)

Ends the sessions issued against a password that has just been replaced.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `bus` | broker | — |
| `auth.auth` | service | [auth](../auth/README.md) |
| `auth-pg` | store | [auth](../auth/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as bus
    participant p1 as auth.auth
    participant p2 as auth-pg
    p0-)p1: PasswordChanged
    p1->>p1: EndAfterCredentialChange
    p1->>p2: ByUserID
    p1->>p2: ByID
    p1->>p2: Save
    p1-)p0: SessionEnded
```

## Steps

<a id="step-s1"></a>
1. **bus** → **auth.auth** — PasswordChanged
   [`auth.auth.user.PasswordChanged`](../auth/auth/aggregates/user.md#event-auth-auth-user-passwordchanged) · [`examples/auth/internal/application/policy/revoke_sessions_on_password_change.go:41`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/policy/revoke_sessions_on_password_change.go#L41) · Seen running in telemetry/traces.jsonl (1 trace).
<a id="step-s2"></a>
2. **auth.auth** ↺ **auth.auth** — EndAfterCredentialChange
   status: declared · [`examples/auth/internal/application/policy/revoke_sessions_on_password_change.go:47`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/policy/revoke_sessions_on_password_change.go#L47)
<a id="step-s3"></a>
3. **auth.auth** → **auth-pg** — ByUserID
   status: declared · [`examples/auth/internal/application/session/usecases/end_after_credential_change/usecase.go:40`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/end_after_credential_change/usecase.go#L40)
<a id="step-s4"></a>
4. **auth.auth** → **auth-pg** — ByID
   status: declared · [`examples/auth/internal/application/session/usecases/end_after_credential_change/usecase.go:62`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/end_after_credential_change/usecase.go#L62) · inside a loop over `change.Ends(sessions, uc.now())`, inside a loop over `retries`.
<a id="step-s5"></a>
5. **auth.auth** → **auth-pg** — Save
   status: declared · [`examples/auth/internal/application/session/usecases/end_after_credential_change/usecase.go:77`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/end_after_credential_change/usecase.go#L77) · inside a loop over `change.Ends(sessions, uc.now())`, inside a loop over `retries`.
<a id="step-s6"></a>
6. **auth.auth** → **bus** — SessionEnded
   [`auth.auth.session.SessionEnded`](../auth/auth/aggregates/session.md#event-auth-auth-session-sessionended) · [`examples/auth/internal/application/session/usecases/end_after_credential_change/usecase.go:77`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/end_after_credential_change/usecase.go#L77) · inside a loop over `change.Ends(sessions, uc.now())`, inside a loop over `retries`.
