# Auth database

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `auth.auth.pg`
- **Kind:** postgres
- **Owner:** [auth.auth](../README.md)
- **Source:** [`examples/auth/internal/*/infrastructure/repository`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/%2A/infrastructure/repository)

## Tables

<a id="relation-auth-auth-pg-lockouts"></a>
### lockouts

aggregate-root · persists [auth.auth.lockout](../aggregates/lockout.md)

| Access | Method | Source |
| --- | --- | --- |
| read | `Postgres.ByUserID` | [`examples/auth/internal/lockout/infrastructure/repository/postgres.go:100`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/lockout/infrastructure/repository/postgres.go#L100) |
| write | `Postgres.Save` | [`examples/auth/internal/lockout/infrastructure/repository/postgres.go:61`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/lockout/infrastructure/repository/postgres.go#L61) |
| write | `Postgres.Save` | [`examples/auth/internal/lockout/infrastructure/repository/postgres.go:78`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/lockout/infrastructure/repository/postgres.go#L78) |

| Column | Type | Null | Key | Maps |
| --- | --- | --- | --- | --- |
| `user_id` | `text` | not null | PK | Lockout.UserID |
| `failures` | `integer` | not null | — | Lockout.Failures |
| `locked_until` | `timestamptz` | null | — | Lockout.LockedUntil |
| `version` | `bigint` | not null | — | — |

<a id="relation-auth-auth-pg-sessions"></a>
### sessions

aggregate-root · persists [auth.auth.session](../aggregates/session.md)

| Access | Method | Source |
| --- | --- | --- |
| read | `Postgres.ByID` | [`examples/auth/internal/session/infrastructure/repository/postgres.go:126`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/repository/postgres.go#L126) |
| read | `Postgres.ByToken` | [`examples/auth/internal/session/infrastructure/repository/postgres.go:126`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/repository/postgres.go#L126) |
| read | `Postgres.ByUserID` | [`examples/auth/internal/session/infrastructure/repository/postgres.go:104`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/repository/postgres.go#L104) |
| write | `Postgres.Save` | [`examples/auth/internal/session/infrastructure/repository/postgres.go:59`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/repository/postgres.go#L59) |
| write | `Postgres.Save` | [`examples/auth/internal/session/infrastructure/repository/postgres.go:73`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/session/infrastructure/repository/postgres.go#L73) |

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

<a id="relation-auth-auth-pg-users"></a>
### users

aggregate-root · persists [auth.auth.user](../aggregates/user.md)

| Access | Method | Source |
| --- | --- | --- |
| read | `Postgres.ByEmail` | [`examples/auth/internal/user/infrastructure/repository/postgres.go:136`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/infrastructure/repository/postgres.go#L136) |
| read | `Postgres.ByID` | [`examples/auth/internal/user/infrastructure/repository/postgres.go:136`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/infrastructure/repository/postgres.go#L136) |
| write | `Postgres.Save` | [`examples/auth/internal/user/infrastructure/repository/postgres.go:73`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/infrastructure/repository/postgres.go#L73) |
| write | `Postgres.Save` | [`examples/auth/internal/user/infrastructure/repository/postgres.go:95`](https://github.com/shortlink-org/portolan/blob/main/examples/auth/internal/user/infrastructure/repository/postgres.go#L95) |

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
