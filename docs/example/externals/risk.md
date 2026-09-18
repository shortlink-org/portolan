# Risk

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `risk`
- **Where:** outside the estate

Scores a login attempt before auth issues a session. Nobody in the estate provides it; the copy of its contract beside auth's adapter is narrowed to the one rpc auth runs, and is all the catalog claims about it.

## Provides

### risk.v1.RiskService

- **Source:** [`examples/auth/internal/session/infrastructure/risk/proto/risk/v1/risk.proto:12`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/risk/proto/risk/v1/risk.proto#L12)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `Assess` | `AssessRequest` | `AssessResponse` | Assess says whether a login attempt should go ahead. |

<a id="message-assessrequest"></a>
<details><summary>AssessRequest</summary>

| Field | Type | Doc |
| --- | --- | --- |
| `user_id` | `string` | The user the attempt is for. Auth has already checked the credentials by the time it asks; risk decides whether that is enough today. |

</details>

<a id="message-assessresponse"></a>
<details><summary>AssessResponse</summary>

| Field | Type |
| --- | --- |
| `verdict` | `Verdict` |

</details>

<a id="enum-verdict"></a>
<details><summary>Verdict (enum)</summary>

Verdict is closed on purpose: a caller switches on it, and a new value is a
contract change rather than a string somebody starts sending.

| Value | Number | Doc |
| --- | --- | --- |
| `VERDICT_UNSPECIFIED` | 0 | — |
| `VERDICT_ALLOW` | 1 | — |
| `VERDICT_BLOCK` | 2 | Refuse the attempt and treat the account as compromised. |

</details>

## Called by

| Service | Call | Status | Source |
| --- | --- | --- | --- |
| [Authentication & Sessions](../auth/auth/README.md) | `risk.v1.RiskService/Assess` | declared | [`examples/auth/internal/session/infrastructure/risk/gen/riskpb/risk_grpc.pb.go`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/risk/gen/riskpb/risk_grpc.pb.go) |
