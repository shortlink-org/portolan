# Change password

*Generated from the portolan catalog · commit `10 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.auth-change-password`
- **Owner:** [auth](../auth/README.md)
- **Source:** [`examples/auth/internal/infrastructure/transport/http/user/change_password.go`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/infrastructure/transport/http/user/change_password.go)

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
   [`examples/auth/internal/infrastructure/transport/http/user/change_password.go:20`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/infrastructure/transport/http/user/change_password.go#L20) · Seen running in telemetry/traces.jsonl (1 trace).
<a id="step-s2"></a>
2. **auth.auth** → **auth-pg** — ByToken
   status: declared · [`examples/auth/internal/application/session/usecases/validate/usecase.go:34`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/validate/usecase.go#L34)
<a id="step-s3"></a>
3. **auth.auth** → **auth-pg** — ByID
   status: declared · [`examples/auth/internal/application/user/usecases/change_password/usecase.go:31`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/user/usecases/change_password/usecase.go#L31)
<a id="step-s4"></a>
4. **auth.auth** → **auth-pg** — Save
   status: declared · [`examples/auth/internal/application/user/usecases/change_password/usecase.go:40`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/user/usecases/change_password/usecase.go#L40)
<a id="step-s5"></a>
5. **auth.auth** → **bus** — PasswordChanged
   [`auth.auth.user.PasswordChanged`](../auth/auth/aggregates/user.md#event-auth-auth-user-passwordchanged) · [`examples/auth/internal/application/user/usecases/change_password/usecase.go:40`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/user/usecases/change_password/usecase.go#L40) · Seen running in telemetry/traces.jsonl (1 trace).
