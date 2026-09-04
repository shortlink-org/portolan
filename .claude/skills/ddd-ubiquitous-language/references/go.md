# Naming in Go

Read off `examples/auth`.

| Thing | Form | Example |
|---|---|---|
| aggregate package | singular noun | `domain/user`, `domain/session` |
| root type | the noun, capitalised | `user.User`, `session.Session` |
| constructor | the business verb for coming into being | `user.Register`, `session.Start` |
| command | the business verb | `ChangePassword`, `Revoke`, `Authenticate` |
| query on the root | what it answers | `Live(now)`, `Validate(now)` |
| value object package | the noun, under `vo/` | `vo/email`, `vo/password`, `vo/token` |
| value object type | the noun, or what it is | `email.Address`, `password.Hash`, `token.Token` |
| rule | the constraint | `MinLengthSpec`, `NoDisplayNameSpec` |
| event | fact, past tense | `event.UserRegistered`, `event.SessionEnded` |
| event topic | `<context>.<Event>` | `auth.PasswordChanged` |
| closed set | the noun, values as adjectives or nouns | `Reason`: `logout`, `revoked`, `password-changed` |
| sentinel error | `Err` + the answer, message prefixed by package | `user.ErrEmailTaken` = `"user: email already registered"` |
| use case package | verb phrase, snake_case | `register`, `change_password`, `end_after_credential_change` |
| use case port | the role, as a noun | `login.Authenticator`, `login.Risk` |
| policy | `<Effect>On<Fact>` | `RevokeSessionsOnPasswordChange` |
| domain service | the situation it decides | `services.CredentialChange` |
| adapter package | port it serves, under the technology | `repository/session`, `bus/user`, `risk` |
| adapter type | the technology | `session.Postgres`, `session.Cached`, `user.InProc`, `risk.Client` |
| route | the noun of the resource | `POST /v1/sessions`, `POST /v1/users/me/password` |

Translation at the boundary, `infrastructure/risk/client.go`: `riskpb.Verdict_VERDICT_BLOCK`
becomes `login.VerdictBlock`; nothing above the adapter imports `riskpb`.
