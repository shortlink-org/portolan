# Get user

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `flow.auth-get-user`
- **Owner:** [auth](../auth/README.md)
- **Source:** `examples/auth/internal/infrastructure/transport/http/user/get.go`

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
    p0->>p1: getUser
    p1->>p2: ByID
```

## Steps

1. **client** → **auth.auth** — getUser
   `examples/auth/internal/infrastructure/transport/http/user/get.go:11` · Seen running in telemetry/traces.jsonl (2 traces).
2. **auth.auth** → **auth-pg** — ByID
   status: declared · `examples/auth/internal/application/user/usecases/get/usecase.go:23`
