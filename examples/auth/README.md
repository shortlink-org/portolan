# Authentication & Sessions

Service `auth` — bounded context **auth**.

Owns *who someone is* and *whether they are still logged in*. It is the only
service in the estate that stores credentials, and the only one allowed to mint
or revoke a session.

## What it does

- Registers subjects and holds their credentials (password hashes, MFA factors).
- Authenticates: checks a credential and answers with a subject or a refusal.
- Issues, refreshes and revokes sessions; hands back an access/refresh token pair.
- Introspects an access token for everyone else — the hot path every
  authenticated request in `shop` goes through.
- Locks a subject after repeated failures and publishes that it did.

## What it does not do

No profile data, no addresses, no payment instruments, no roles beyond coarse
scopes. Other contexts hold their own view of a customer and reference it by
opaque subject id; nothing outside `auth` ever sees a credential.

## Publishes

`IdentityRegistered`, `EmailVerified`, `IdentityLocked`, `SessionIssued`,
`SessionRevoked`.
