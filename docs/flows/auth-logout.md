# Logout

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Id:** `flow.auth-logout`
- **Owner:** [auth](../auth/README.md)
- **Source:** `examples/auth/internal/infrastructure/transport/http/session/logout.go`

Ends the session behind a token.

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
    p0->>p1: logout → 204
    p1->>p2: ByToken
    p1->>p2: Save
    p1-)p3: SessionEnded
```

## Steps

1. **client** → **auth.auth** — logout → 204
   `examples/auth/internal/infrastructure/transport/http/session/logout.go:15` · Seen running in telemetry/traces.jsonl (1 trace).
2. **auth.auth** → **auth-pg** — ByToken
   status: declared · `examples/auth/internal/application/session/usecases/logout/usecase.go:35`
3. **auth.auth** → **auth-pg** — Save
   status: declared · `examples/auth/internal/application/session/usecases/logout/usecase.go:49`
4. **auth.auth** → **bus** — SessionEnded
   [auth.auth.session.SessionEnded](../auth/auth/aggregates/session.md) · `examples/auth/internal/application/session/usecases/logout/usecase.go:49` · Seen running in telemetry/traces.jsonl (1 trace).
