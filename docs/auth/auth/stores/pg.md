# Auth database

*Generated from the portolan catalog · commit `4 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `auth.auth.pg`
- **Kind:** postgres
- **Owner:** [auth.auth](../README.md)
- **Source:** `examples/auth/internal/infrastructure/repository`

## Tables

### lockouts

aggregate-root · persists [auth.auth.lockout](../aggregates/lockout.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `user_id` | `text` | not null | PK | Lockout.UserID |
| `failures` | `integer` | not null | — | Lockout.Failures |
| `locked_until` | `timestamptz` | null | — | Lockout.LockedUntil |
| `version` | `bigint` | not null | — | — |

### sessions

aggregate-root · persists [auth.auth.session](../aggregates/session.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | Session.ID |
| `user_id` | `text` | not null | — | Session.UserID |
| `token` | `text` | not null | — | Session.Token |
| `issued_at` | `timestamptz` | not null | — | Session.IssuedAt |
| `expires_at` | `timestamptz` | not null | — | Session.ExpiresAt |
| `revoked_at` | `timestamptz` | null | — | Session.RevokedAt |
| `version` | `bigint` | not null | — | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `sessions_token_key` | token | unique |
| `sessions_user_id_idx` | user_id, issued_at | index |

### users

aggregate-root · persists [auth.auth.user](../aggregates/user.md)

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `id` | `text` | not null | PK | User.ID |
| `email` | `text` | not null | — | User.Email |
| `password_hash` | `text` | not null | — | User.Password |
| `created_at` | `timestamptz` | not null | — | User.CreatedAt |
| `version` | `bigint` | not null | — | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `users_email_key` | email | unique |
