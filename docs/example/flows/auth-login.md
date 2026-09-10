# Login

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.auth-login`
- **Owner:** [auth](../auth/README.md)
- **Source:** [`examples/auth/internal/session/infrastructure/http/login.go`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/http/login.go)

Turns credentials into a session.

## Participants

| Participant | Kind | Context | Label |
| --- | --- | --- | --- |
| `client` | actor | — | — |
| `auth.auth` | service | [auth](../auth/README.md) | — |
| `auth-pg` | store | [auth](../auth/README.md) | — |
| `bus` | broker | — | — |
| `risk-v1` | unknown | — | risk.v1 |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as auth.auth
    participant p2 as auth-pg
    participant p3 as bus
    participant p4 as risk.v1
    p0->>p1: login → Session
    p1->>p1: CheckCredentials
    p1->>p2: ByEmail
    p1->>p1: Check
    p1->>p2: ByUserID
    alt !uc.verifier.Verify(in.Password, u.Password)
        p1->>p1: RecordFailure
        p1->>p2: ByUserID
        p1->>p2: Save
        p1-)p3: AccountLocked
        Note over p3: flow ends here
    else otherwise
    end
    p1->>p1: RecordSuccess
    p1->>p2: ByUserID
    p1->>p2: Save
    p1->>p4: Assess
    alt verdict == VerdictBlock
        p1->>p2: ByUserID
        p1->>p2: Save
        p1-)p3: SessionEnded
        Note over p3: flow ends here
    else otherwise
    end
    p1->>p2: Save
    p1-)p3: SessionStarted
```

## Steps

<a id="step-s1"></a>
1. **client** → **auth.auth** — login → Session
   [`examples/auth/internal/session/infrastructure/http/login.go:11`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/http/login.go#L11) · Seen running in telemetry/traces.jsonl (2 traces).
<a id="step-s2"></a>
2. **auth.auth** ↺ **auth.auth** — CheckCredentials
   status: declared · [`examples/auth/internal/session/application/login/usecase.go:57`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/application/login/usecase.go#L57) · Port `Authenticator`, bound at assembly to the CheckCredentials use case.
<a id="step-s3"></a>
3. **auth.auth** → **auth-pg** — ByEmail
   status: declared · [`examples/auth/internal/user/application/check_credentials/usecase.go:42`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/application/check_credentials/usecase.go#L42)
<a id="step-s4"></a>
4. **auth.auth** ↺ **auth.auth** — Check
   status: declared · [`examples/auth/internal/user/application/check_credentials/usecase.go:50`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/application/check_credentials/usecase.go#L50) · Port `Lockout`, bound at assembly to the Check use case.
<a id="step-s5"></a>
5. **auth.auth** → **auth-pg** — ByUserID
   status: declared · [`examples/auth/internal/lockout/application/check/usecase.go:26`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/lockout/application/check/usecase.go#L26)

> **One of**
>
> *!uc.verifier.Verify(in.Password, u.Password) — *ends the flow**
>
> <a id="step-s6"></a>
> 6. **auth.auth** ↺ **auth.auth** — RecordFailure
>    status: declared · [`examples/auth/internal/user/application/check_credentials/usecase.go:59`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/application/check_credentials/usecase.go#L59) · Port `Lockout`, bound at assembly to the RecordFailure use case.
> <a id="step-s7"></a>
> 7. **auth.auth** → **auth-pg** — ByUserID
>    status: declared · [`examples/auth/internal/lockout/application/record_failure/usecase.go:36`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/lockout/application/record_failure/usecase.go#L36) · inside a loop over `retries`.
> <a id="step-s8"></a>
> 8. **auth.auth** → **auth-pg** — Save
>    status: declared · [`examples/auth/internal/lockout/application/record_failure/usecase.go:53`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/lockout/application/record_failure/usecase.go#L53) · inside a loop over `retries`.
> <a id="step-s9"></a>
> 9. **auth.auth** → **bus** — AccountLocked
>    [`auth.auth.lockout.AccountLocked`](../auth/auth/aggregates/lockout.md#event-auth-auth-lockout-accountlocked) · status: declared · [`examples/auth/internal/lockout/application/record_failure/usecase.go:53`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/lockout/application/record_failure/usecase.go#L53) · inside a loop over `retries`.
>
> *otherwise*

<a id="step-s11"></a>
10. **auth.auth** ↺ **auth.auth** — RecordSuccess
   status: declared · [`examples/auth/internal/user/application/check_credentials/usecase.go:68`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/application/check_credentials/usecase.go#L68) · Port `Lockout`, bound at assembly to the RecordSuccess use case.
<a id="step-s12"></a>
11. **auth.auth** → **auth-pg** — ByUserID
   status: declared · [`examples/auth/internal/lockout/application/record_success/usecase.go:31`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/lockout/application/record_success/usecase.go#L31) · inside a loop over `retries`.
<a id="step-s13"></a>
12. **auth.auth** → **auth-pg** — Save
   status: declared · [`examples/auth/internal/lockout/application/record_success/usecase.go:43`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/lockout/application/record_success/usecase.go#L43) · inside a loop over `retries`.
<a id="step-s14"></a>
13. **auth.auth** → **risk-v1** — Assess
   `risk.v1.RiskService/Assess` · status: unresolved · [`examples/auth/internal/session/application/login/usecase.go:62`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/application/login/usecase.go#L62)

> **One of**
>
> *verdict == VerdictBlock — *ends the flow**
>
> <a id="step-s15"></a>
> 14. **auth.auth** → **auth-pg** — ByUserID
>    status: declared · [`examples/auth/internal/session/application/login/usecase.go:91`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/application/login/usecase.go#L91)
> <a id="step-s16"></a>
> 15. **auth.auth** → **auth-pg** — Save
>    status: declared · [`examples/auth/internal/session/application/login/usecase.go:101`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/application/login/usecase.go#L101) · inside a loop over `sessions`.
> <a id="step-s17"></a>
> 16. **auth.auth** → **bus** — SessionEnded
>    [`auth.auth.session.SessionEnded`](../auth/auth/aggregates/session.md#event-auth-auth-session-sessionended) · status: declared · [`examples/auth/internal/session/application/login/usecase.go:101`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/application/login/usecase.go#L101) · inside a loop over `sessions`.
>
> *otherwise*

<a id="step-s19"></a>
17. **auth.auth** → **auth-pg** — Save
   status: declared · [`examples/auth/internal/session/application/login/usecase.go:77`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/application/login/usecase.go#L77)
<a id="step-s20"></a>
18. **auth.auth** → **bus** — SessionStarted
   [`auth.auth.session.SessionStarted`](../auth/auth/aggregates/session.md#event-auth-auth-session-sessionstarted) · [`examples/auth/internal/session/application/login/usecase.go:77`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/application/login/usecase.go#L77) · Seen running in telemetry/traces.jsonl (2 traces).
