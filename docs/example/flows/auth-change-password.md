# Change password

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.auth-change-password`
- **Owner:** [auth](../auth/README.md)
- **Source:** [`examples/auth/internal/user/infrastructure/http/change_password.go`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/infrastructure/http/change_password.go)

Replaces the password of a user, given the current one.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `auth.auth` | service | [auth](../auth/README.md) |
| `auth-pg` | store | [auth](../auth/README.md) |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as auth.auth
    participant p2 as auth-pg
    participant p3 as bus
    p0->>p1: changePassword → 204
    p1->>p2: ByToken
    p1->>p2: ByID
    p1->>p2: Save
    p1-)p3: PasswordChanged
```

## Steps

<a id="step-s1"></a>
1. **client** → **auth.auth** — changePassword → 204
   [`examples/auth/internal/user/infrastructure/http/change_password.go:20`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/infrastructure/http/change_password.go#L20) · Seen running in telemetry/traces.jsonl (1 trace).
<a id="step-s2"></a>
2. **auth.auth** → **auth-pg** — ByToken
   status: declared · [`examples/auth/internal/session/application/validate/usecase.go:33`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/application/validate/usecase.go#L33)
<a id="step-s3"></a>
3. **auth.auth** → **auth-pg** — ByID
   status: declared · [`examples/auth/internal/user/application/change_password/usecase.go:32`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/application/change_password/usecase.go#L32)
<a id="step-s4"></a>
4. **auth.auth** → **auth-pg** — Save
   status: declared · [`examples/auth/internal/user/application/change_password/usecase.go:48`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/application/change_password/usecase.go#L48)
<a id="step-s5"></a>
5. **auth.auth** → **bus** — PasswordChanged
   [`auth.auth.user.PasswordChanged`](../auth/auth/aggregates/user.md#event-auth-auth-user-passwordchanged) · [`examples/auth/internal/user/application/change_password/usecase.go:48`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/application/change_password/usecase.go#L48) · Seen running in telemetry/traces.jsonl (1 trace).

## Recordings

Traces this flow was seen running in, kept as examples: which steps ran, how long each took, and the names the spans carried.

- **Recording:** [`examples/auth/telemetry/traces.jsonl`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/telemetry/traces.jsonl)
- **Trace:** `fc0d47a555b03d7af44a85259857c04e`
- **Recorded:** 2026-09-05T20:47:00.207552Z
- **Duration:** 41.39 ms

| Step | Span | Duration | Attributes |
| --- | --- | --- | --- |
| [s1](auth-change-password.md#step-s1) | `POST /v1/users/me/password` | 41.39 ms | `http.request.method=POST` `http.response.status_code=204` `http.route=/v1/users/me/password` `server.address=localhost` `server.port=8080` |
| [s5](auth-change-password.md#step-s5) | `publish auth.PasswordChanged` | 0.002 ms | `event.name=auth.PasswordChanged` `messaging.destination.name=auth_user` `messaging.operation.type=publish` `messaging.system=outbox` |
