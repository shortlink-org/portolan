# Auth database

*Generated from the portolan catalog · commit `2 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `auth.auth.pg`
- **Kind:** postgres
- **Owner:** [auth.auth](../README.md)
- **Source:** `examples/auth/internal/infrastructure/repository`

## Tables

### sessions

aggregate-root · persists [auth.auth.session](../aggregates/session.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `text` | not null | PK |
| `user_id` | `text` | not null | — |
| `token` | `text` | not null | — |
| `issued_at` | `timestamptz` | not null | — |
| `expires_at` | `timestamptz` | not null | — |
| `revoked_at` | `timestamptz` | null | — |
| `version` | `bigint` | not null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `sessions_token_key` | token | unique |
| `sessions_user_id_idx` | user_id, issued_at | index |

### users

aggregate-root · persists [auth.auth.user](../aggregates/user.md)

| Column | Type | Null | Key |
| --- | --- | --- | --- |
| `id` | `text` | not null | PK |
| `email` | `text` | not null | — |
| `password_hash` | `text` | not null | — |
| `created_at` | `timestamptz` | not null | — |
| `version` | `bigint` | not null | — |

| Index | Columns | Kind |
| --- | --- | --- |
| `users_email_key` | email | unique |
