# Get user

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.auth-get-user`
- **Owner:** [auth](../auth/README.md)
- **Source:** [`examples/auth/internal/user/infrastructure/http/get.go`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/infrastructure/http/get.go)

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
   [`examples/auth/internal/user/infrastructure/http/get.go:11`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/infrastructure/http/get.go#L11) · Seen running in telemetry/traces.jsonl (3 traces).
<a id="step-s2"></a>
2. **auth.auth** → **auth-pg** — ByID
   status: declared · [`examples/auth/internal/user/application/get/usecase.go:22`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/application/get/usecase.go#L22)

## Recordings

Traces this flow was seen running in, kept as examples: which steps ran, how long each took, and the names the spans carried.

- **Recording:** [`examples/auth/telemetry/traces.jsonl`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/telemetry/traces.jsonl)
- **Trace:** `11892613b4650af0870b876205a89fe5`
- **Recorded:** 2026-09-05T20:47:00.06401Z
- **Duration:** 1.845 ms

| Step | Span | Duration | Attributes |
| --- | --- | --- | --- |
| [s1](auth-get-user.md#step-s1) | `GET /v1/users/{userId}` | 1.845 ms | `http.request.method=GET` `http.response.status_code=404` `http.route=/v1/users/{userId}` `server.address=localhost` `server.port=8080` |

- **Recording:** [`examples/auth/telemetry/traces.jsonl`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/telemetry/traces.jsonl)
- **Trace:** `81bc03dd8efa5caad98d84087bf15f84`
- **Recorded:** 2026-09-05T20:47:00.077493Z
- **Duration:** 0.729 ms

| Step | Span | Duration | Attributes |
| --- | --- | --- | --- |
| [s1](auth-get-user.md#step-s1) | `GET /v1/users/{userId}` | 0.729 ms | `http.request.method=GET` `http.response.status_code=404` `http.route=/v1/users/{userId}` `server.address=localhost` `server.port=8080` |

- **Recording:** [`examples/auth/telemetry/traces.jsonl`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/telemetry/traces.jsonl)
- **Trace:** `233c6f00d7a0373ee63a2e9c7bbc1f2e`
- **Recorded:** 2026-09-05T20:47:06.335468Z
- **Duration:** 0.992 ms

| Step | Span | Duration | Attributes |
| --- | --- | --- | --- |
| [s1](auth-get-user.md#step-s1) | `GET /v1/users/{userId}` | 0.992 ms | `http.request.method=GET` `http.response.status_code=200` `http.route=/v1/users/{userId}` `server.address=localhost` `server.port=8080` |
