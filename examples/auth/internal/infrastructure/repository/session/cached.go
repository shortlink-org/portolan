package session

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	sdkcache "github.com/shortlink-org/go-sdk/cache"
	sdkuow "github.com/shortlink-org/go-sdk/uow"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session/dto"
)

// keyPrefix namespaces this service's entries. A redis is rarely one service's,
// and a prefix is what makes somebody else's key not this service's problem.
const keyPrefix = "auth:session:"

// The two kinds of entry, under the prefix. A live session is kept under one
// key; the fact that a session was revoked is kept under another, and the read
// path consults the second before it trusts the first. See Save for why the
// two cannot be one key.
const (
	livePrefix    = keyPrefix + "token:"
	revokedPrefix = keyPrefix + "revoked:"
)

// revokedMarker is what a revocation entry holds. Its presence is the fact; the
// value is nothing.
var revokedMarker = []byte{'1'}

// Cached is the session store with a cache in front of it.
//
// It implements the same port as Postgres and holds one, so nothing above it
// can tell which of the two it got. That is the whole of it: not one use case
// was changed to add caching, and none could have been, because they take
// session.Repository and always did.
//
// The cache itself comes from go-sdk: what is here is the decision of what to
// keep, for how long, and when to forget it - which is the only part of caching
// that is about sessions. Opening a connection to redis is not, and there is no
// adapter for one in this service.
//
// Only ByToken is cached. That is the hot path - every authenticated request in
// the estate ends there - and it is the only read where the same answer is
// asked for often enough to be worth keeping. ByID is read by the code that is
// about to write, and ByUserID answers a question about a set, which is the
// kind of entry nothing can invalidate honestly: a session started for that
// user changes the answer, and the write that started it never knew the list
// existed.
//
// What the cache must never do is answer "live" for a session the store says
// is revoked. The domain's rule is that a revoked session never comes back,
// and the cache keeps the same rule in the same direction: a revocation is
// written down under its own key, for as long as the session would have lived,
// and a token with that entry is never answered from the cache again. Only a
// live session is ever stored, so the cache moves the one way the session
// does. Why a plain "drop the entry on write" is not enough is at Save.
type Cached struct {
	next  session.Repository
	cache sdkcache.Cache
	ttl   time.Duration
	now   func() time.Time
}

var _ session.Repository = (*Cached)(nil)

// NewCached wraps a store. ttl is the longest a live entry may survive - see
// the note on store for what else shortens it.
func NewCached(next session.Repository, store sdkcache.Cache, ttl time.Duration, now func() time.Time) *Cached {
	return &Cached{next: next, cache: store, ttl: ttl, now: now}
}

// ByToken answers from the cache when it can.
//
// Every cache failure below is swallowed, and deliberately: the database is
// still there, and a service that returns 500 because redis is unreachable has
// made itself less available by trying to be faster. What it costs is that a
// cache which is down is silent about it, so this is a place that wants a
// metric before it wants anything else.
//
// Swallowed is not the same as trusted. A failure to read the revocation entry
// is treated as "cannot tell", and a session this cache cannot vouch for is
// read from the store and not kept.
func (c *Cached) ByToken(ctx context.Context, presented token.Token) (*session.Session, error) {
	// Inside a transaction the cache is not consulted at all. A use case that
	// read through it would be deciding on a copy taken before its transaction
	// began - a copy that transaction has never seen and cannot have locked -
	// and the write it goes on to make would be built on that.
	if sdkuow.HasTx(ctx) {
		return c.next.ByToken(ctx, presented)
	}

	sum := digest(presented)
	liveKey, revokedKey := livePrefix+sum, revokedPrefix+sum

	// The revocation is checked first, and a cached live copy is only believed
	// when the cache has positively said there is none. This is the read that
	// makes the two keys work: whatever a racing reader left under the live
	// key after the revocation, it is not consulted while this entry stands.
	switch _, err := c.cache.Get(ctx, revokedKey); {
	case err == nil:
		return c.next.ByToken(ctx, presented)

	case errors.Is(err, sdkcache.ErrMiss):
		// Never revoked, as far as the cache knows. The ordinary answer.

	default:
		// Unreachable, most likely. The store still answers, and nothing is
		// kept from an answer the cache could not be asked about.
		return c.next.ByToken(ctx, presented)
	}

	switch snapshot, err := sdkcache.GetJSON[dto.Snapshot](ctx, c.cache, liveKey); {
	case err == nil:
		cached, err := snapshot.Session()
		if err == nil {
			return cached, nil
		}

		// Decoded, but not into a session this domain would have made - a
		// stored token that no longer parses, most likely. Drop it and ask the
		// database.
		_ = c.cache.Delete(ctx, liveKey)

	case errors.Is(err, sdkcache.ErrMiss):
		// Nothing kept. The ordinary answer, not a failure.

	default:
		// Either the entry did not decode or the cache is unreachable, and both
		// are survivable because the database still is. The drop is best
		// effort: if the cache is the broken thing it will fail here too, which
		// is the same silence as the read.
		_ = c.cache.Delete(ctx, liveKey)
	}

	stored, err := c.next.ByToken(ctx, presented)
	if err != nil {
		// A token nobody has ever seen is not cached. It would work - a token
		// that is not in the store is never one we minted, so the answer cannot
		// change - but it would mean anybody sending made-up tokens gets to
		// decide what this cache holds, and the miss they cause costs one
		// indexed lookup either way.
		return nil, err
	}

	c.store(ctx, liveKey, stored)

	return stored, nil
}

// ByID goes straight to the store. It is read by end_after_credential_change,
// immediately before it writes what it read.
func (c *Cached) ByID(ctx context.Context, id string) (*session.Session, error) {
	return c.next.ByID(ctx, id)
}

// ByUserID goes straight to the store; see the note on Cached for why a list is
// not cached here.
func (c *Cached) ByUserID(ctx context.Context, userID string) ([]*session.Session, error) {
	return c.next.ByUserID(ctx, userID)
}

// Save writes through, and keeps the cache from ever saying otherwise.
//
// Why a revocation is recorded rather than only dropped: auth.0010,
// docs/adr/0010-a-revocation-is-written-to-the-cache.md.
//
// Dropping the live entry around the write is necessary and was never enough.
// A reader that missed, read the store a moment before the revocation
// committed and stored what it read a moment after the drop leaves a live copy
// behind, and nothing about a drop can stop it: the reader cannot know it lost
// the race, and the writer has already run. A drop is also all that stands
// between a logout and a stale copy when the drop itself fails.
//
// So a revocation is not only forgotten, it is written down - under a key of
// its own, that only this method writes and no read ever does, for as long as
// the session it ends would have lived. ByToken reads that key before it
// trusts anything else, which makes the racing reader's copy harmless: it is
// not consulted. The two facts cannot share a key, because then the reader's
// copy would overwrite the revocation, which is the race again.
//
// The entry is written before the store is, so that a process which dies
// between the commit and anything after it has still left the revocation
// where the next read will find it. A write the store then refuses leaves a
// revocation entry for a session that is still live, and what that costs is
// that the token is read from the store for the rest of its life - a session
// that is not cached, never one that is wrong.
func (c *Cached) Save(ctx context.Context, s *session.Session, events ...event.Event) error {
	// A session being inserted cannot be cached: its token was minted moments
	// ago and nothing has had the chance to ask for it.
	if s.Version == 0 {
		return c.next.Save(ctx, s, events...)
	}

	sum := digest(s.Token)
	liveKey := livePrefix + sum

	if !s.RevokedAt.IsZero() {
		c.markRevoked(ctx, revokedPrefix+sum, s)
	}

	// Dropping the live entry before as well as after the write is what
	// survives a revocation whose entry above could not be written: the drop
	// before covers a process that dies after the commit, the one after covers
	// a reader that repopulated the entry while the write was in flight.
	_ = c.cache.Delete(ctx, liveKey)

	if err := c.next.Save(ctx, s, events...); err != nil {
		return err
	}

	// The write is done. A failure here is not reported: telling a caller
	// their logout failed when it committed is the worse of the two lies. What
	// a cache that accepts reads while refusing writes costs is a live copy
	// for the rest of its ttl, which is the number the ttl was chosen by.
	_ = c.cache.Delete(ctx, liveKey)

	return nil
}

// markRevoked writes the revocation down for what is left of the session's
// life. Past its expiry the store refuses the session on its own and nothing
// live is ever cached for it, so there is nothing to keep.
func (c *Cached) markRevoked(ctx context.Context, key string, s *session.Session) {
	left := s.ExpiresAt.Sub(c.now())
	if left <= 0 {
		return
	}

	_ = c.cache.Set(ctx, key, revokedMarker, left)
}

// store keeps a live session for the shorter of the configured ttl and what is
// left of the session's own life.
//
// Only a live one. A revoked session is refused by the store from now on, and
// keeping that refusal would cost a key for something a client has already
// stopped presenting; an expired one is refused the same way, and expiry is the
// one way a session changes without anything running to notice. Both are the
// bound on the ttl as well: an entry outliving the session it describes would
// have this service holding an answer the database would no longer give.
func (c *Cached) store(ctx context.Context, key string, s *session.Session) {
	now := c.now()
	if !s.Live(now) {
		return
	}

	ttl := c.ttl
	if left := s.ExpiresAt.Sub(now); left < ttl {
		ttl = left
	}

	_ = sdkcache.SetJSON(ctx, c.cache, key, dto.NewSnapshot(s), ttl)
}

// digest is the part of a cache key that names a token, and it hashes.
//
// The token is the credential itself. Built into a key, every live credential
// in the estate would be sitting in whatever a KEYS scan, a slow-log line or a
// redis dump ends up on - none of which is treated like a password store,
// because none of them is supposed to hold passwords. The hash is enough to
// find the entry again and no use to anybody who reads it.
func digest(presented token.Token) string {
	sum := sha256.Sum256([]byte(presented.String()))

	return hex.EncodeToString(sum[:])
}
