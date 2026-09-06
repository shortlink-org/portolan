# Get user

*Generated from the portolan catalog · commit `11 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.auth-get-user`
- **Owner:** [auth](../auth/README.md)
- **Source:** [`examples/auth/internal/infrastructure/transport/http/user/get.go`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/infrastructure/transport/http/user/get.go)

Reads a user by id.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `auth.auth` | service | [auth](../auth/README.md) |
| `auth-pg` | store | [auth](../auth/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as auth.auth
    participant p2 as auth-pg
    p0->>p1: getUser → User
    p1->>p2: ByID
```

## Steps

<a id="step-s1"></a>
1. **client** → **auth.auth** — getUser → User
   [`examples/auth/internal/infrastructure/transport/http/user/get.go:11`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/infrastructure/transport/http/user/get.go#L11) · Seen running in telemetry/traces.jsonl (3 traces).
<a id="step-s2"></a>
2. **auth.auth** → **auth-pg** — ByID
   status: declared · [`examples/auth/internal/application/user/usecases/get/usecase.go:23`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/user/usecases/get/usecase.go#L23)
