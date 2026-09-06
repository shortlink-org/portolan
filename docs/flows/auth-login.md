# Login

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `flow.auth-login`
- **Owner:** [auth](../auth/README.md)
- **Source:** [`examples/auth/internal/infrastructure/transport/http/session/login.go`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/infrastructure/transport/http/session/login.go)

Turns credentials into a session.

## Participants

| Participant | Kind | Context | Label |
| --- | --- | --- | --- |
| `client` | actor | — | — |
| `auth.auth` | service | [auth](../auth/README.md) | — |
| `auth-pg` | store | [auth](../auth/README.md) | — |
| `risk-v1` | unknown | — | risk.v1 |
| `bus` | broker | — | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as auth.auth
    participant p2 as auth-pg
    participant p3 as risk.v1
    participant p4 as bus
    p0->>p1: login → Session
    p1->>p1: Authenticate
    p1->>p2: ByEmail
    p1->>p1: Check
    p1->>p2: ByUserID
    alt err != nil
        p1->>p1: RecordFailure
        p1->>p2: ByUserID
        p1->>p2: Save
        Note over p2: flow ends here
    else otherwise
    end
    p1->>p1: RecordSuccess
    p1->>p2: ByUserID
    p1->>p2: Save
    p1->>p3: Assess
    alt verdict == VerdictBlock
        p1->>p2: ByUserID
        p1->>p2: Save
        p1-)p4: SessionEnded
        Note over p4: flow ends here
    else otherwise
    end
    p1->>p2: Save
    p1-)p4: SessionStarted
```

## Steps

<a id="step-s1"></a>
1. **client** → **auth.auth** — login → Session
   [`examples/auth/internal/infrastructure/transport/http/session/login.go:11`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/infrastructure/transport/http/session/login.go#L11) · Seen running in telemetry/traces.jsonl (2 traces).
<a id="step-s2"></a>
2. **auth.auth** ↺ **auth.auth** — Authenticate
   status: declared · [`examples/auth/internal/application/session/usecases/login/usecase.go:58`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/login/usecase.go#L58) · Port `Authenticator`, bound at assembly to the Authenticate use case.
<a id="step-s3"></a>
3. **auth.auth** → **auth-pg** — ByEmail
   status: declared · [`examples/auth/internal/application/user/usecases/authenticate/usecase.go:41`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/user/usecases/authenticate/usecase.go#L41)
<a id="step-s4"></a>
4. **auth.auth** ↺ **auth.auth** — Check
   status: declared · [`examples/auth/internal/application/user/usecases/authenticate/usecase.go:49`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/user/usecases/authenticate/usecase.go#L49) · Port `Lockout`, bound at assembly to the Check use case.
<a id="step-s5"></a>
5. **auth.auth** → **auth-pg** — ByUserID
   status: declared · [`examples/auth/internal/application/lockout/usecases/check/usecase.go:27`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/lockout/usecases/check/usecase.go#L27)

> **One of**
>
> *err != nil — *ends the flow**
>
> <a id="step-s6"></a>
> 6. **auth.auth** ↺ **auth.auth** — RecordFailure
>    status: declared · [`examples/auth/internal/application/user/usecases/authenticate/usecase.go:58`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/user/usecases/authenticate/usecase.go#L58) · Port `Lockout`, bound at assembly to the RecordFailure use case.
> <a id="step-s7"></a>
> 7. **auth.auth** → **auth-pg** — ByUserID
>    status: declared · [`examples/auth/internal/application/lockout/usecases/record_failure/usecase.go:37`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/lockout/usecases/record_failure/usecase.go#L37) · inside a loop over `retries`.
> <a id="step-s8"></a>
> 8. **auth.auth** → **auth-pg** — Save
>    status: declared · [`examples/auth/internal/application/lockout/usecases/record_failure/usecase.go:54`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/lockout/usecases/record_failure/usecase.go#L54) · inside a loop over `retries`.
>
> *otherwise*

<a id="step-s10"></a>
9. **auth.auth** ↺ **auth.auth** — RecordSuccess
   status: declared · [`examples/auth/internal/application/user/usecases/authenticate/usecase.go:67`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/user/usecases/authenticate/usecase.go#L67) · Port `Lockout`, bound at assembly to the RecordSuccess use case.
<a id="step-s11"></a>
10. **auth.auth** → **auth-pg** — ByUserID
   status: declared · [`examples/auth/internal/application/lockout/usecases/record_success/usecase.go:32`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/lockout/usecases/record_success/usecase.go#L32) · inside a loop over `retries`.
<a id="step-s12"></a>
11. **auth.auth** → **auth-pg** — Save
   status: declared · [`examples/auth/internal/application/lockout/usecases/record_success/usecase.go:44`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/lockout/usecases/record_success/usecase.go#L44) · inside a loop over `retries`.
<a id="step-s13"></a>
12. **auth.auth** → **risk-v1** — Assess
   `risk.v1.RiskService/Assess` · status: unresolved · [`examples/auth/internal/application/session/usecases/login/usecase.go:63`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/login/usecase.go#L63)

> **One of**
>
> *verdict == VerdictBlock — *ends the flow**
>
> <a id="step-s14"></a>
> 13. **auth.auth** → **auth-pg** — ByUserID
>    status: declared · [`examples/auth/internal/application/session/usecases/login/usecase.go:92`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/login/usecase.go#L92)
> <a id="step-s15"></a>
> 14. **auth.auth** → **auth-pg** — Save
>    status: declared · [`examples/auth/internal/application/session/usecases/login/usecase.go:102`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/login/usecase.go#L102) · inside a loop over `sessions`.
> <a id="step-s16"></a>
> 15. **auth.auth** → **bus** — SessionEnded
>    [`auth.auth.session.SessionEnded`](../auth/auth/aggregates/session.md#event-auth-auth-session-sessionended) · status: declared · [`examples/auth/internal/application/session/usecases/login/usecase.go:102`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/login/usecase.go#L102) · inside a loop over `sessions`.
>
> *otherwise*

<a id="step-s18"></a>
16. **auth.auth** → **auth-pg** — Save
   status: declared · [`examples/auth/internal/application/session/usecases/login/usecase.go:78`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/login/usecase.go#L78)
<a id="step-s19"></a>
17. **auth.auth** → **bus** — SessionStarted
   [`auth.auth.session.SessionStarted`](../auth/auth/aggregates/session.md#event-auth-auth-session-sessionstarted) · [`examples/auth/internal/application/session/usecases/login/usecase.go:78`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/application/session/usecases/login/usecase.go#L78) · Seen running in telemetry/traces.jsonl (2 traces).
