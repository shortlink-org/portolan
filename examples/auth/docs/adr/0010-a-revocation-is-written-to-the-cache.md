# auth.0010 — A revocation is written to the cache, not only dropped from it

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** auth.auth

## Context and Problem Statement

auth.0008 put a cache in front of `ByToken` and kept a revocation out of it
by dropping the entry before and after the write. Is a drop enough to keep
the cache from ever saying "live" about a session the store says is revoked?

It is not, twice over. A reader that missed, read the store a moment before
the revocation committed and stored its copy a moment after the drop leaves
a live entry behind, and no drop can reach it: the reader cannot know it
lost the race, and the writer has already run. And when the drop is the
thing that fails while reads keep succeeding, the same entry survives for
the rest of its ttl. In both cases a token that was logged out passes
`Validate` for up to a minute, which contradicts the domain's rule that a
revoked session never comes back - and means the cached repository is not
the same port as the store it hides.

## Decision Drivers

- A revoked token is never answered "live" from the cache, in any
  interleaving of a reader and a revoking writer.
- The hot path stays cheap: one read of the cache on a hit.
- A cache that is down stays an inconvenience, not an outage.
- The cache does not need an operation the port does not have (no
  compare-and-set, no set-if-absent).

## Considered Options

1. **Drop harder** — delete before and after the write, and again after a
   delay. Narrows the window; never closes it, and does nothing for a drop
   that fails.
2. **Write the revoked copy through** — after the commit, store the revoked
   snapshot under the same key instead of deleting it. The racing reader's
   live copy overwrites it: the race, unchanged.
3. **Record the revocation under its own key** — a second entry, written by
   `Save` alone and read by `ByToken` first, for as long as the session
   would have lived. Only a live session is ever stored under the first key.
   Whatever a racing reader leaves there is not consulted while the
   revocation stands.
4. **Fail the write when the cache cannot be told** — return the drop's
   error from `Save`. Turns a cache outage into a logout outage, and
   reports as failed a revocation that committed.

## Decision Outcome

Chosen option: **record the revocation under its own key**.

| | closes the race | survives a failed drop | hit cost | cache down is not an outage |
|---|---|---|---|---|
| drop harder | no | no | one read | yes |
| write through | no | partly | one read | yes |
| own key | yes | yes | two reads | yes |
| fail the write | no | yes | one read | no |

Two reads on a hit is what is given up: the revocation entry is checked
before the live copy is believed. That is one more round trip to redis per
authenticated request, and it buys the property the whole decision is for.
The two facts cannot share a key, because a reader's write would then
overwrite a revocation, which is the race again.

The entry is written before the store is, so a process that dies between
the commit and anything after it has still left the revocation where the
next read finds it. A write the store then refuses leaves a revocation for
a session that is still live; what that costs is one token read from the
store for the rest of its life, never one that is wrong. The entry lives as
long as the session would have: after expiry the store refuses the session
on its own and nothing live is ever cached for it.

The residual risk, accepted: a cache that answers reads while refusing
every write can still hold a live copy for the rest of its ttl. That is
narrower than before - the same cache also refuses the revocation - and it
is the number the ttl was chosen by.

### Consequences

- Good: a revoked token is not answered from the cache again, whichever of
  a reader and a revoking writer got there first, and whether or not the
  drop succeeded.
- Good: the cached repository is again the same port as the store; nothing
  above it changed.
- Bad: one more cache read per hit on the estate's hottest path.
- Bad: a revoked or refused-to-revoke token costs a store read every time
  it is presented, for the rest of its life. A client that was logged out
  stops presenting it, so in practice this is nothing.
- Neutral: a session the store says is revoked or expired is no longer
  stored at all; it never needed to be.
