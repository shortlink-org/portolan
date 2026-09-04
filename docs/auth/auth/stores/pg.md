# Auth database

*Generated from the portolan catalog · commit `2 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `auth.auth.pg`
- **Kind:** postgres
- **Owner:** [auth.auth](../README.md)
- **Source:** `examples/auth/internal/infrastructure/repository`

## Tables

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
