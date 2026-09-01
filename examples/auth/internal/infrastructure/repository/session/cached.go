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
const keyPrefix = "auth:session:token:"

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
type Cached struct {
	next  session.Repository
	cache sdkcache.Cache
	ttl   time.Duration
	now   func() time.Time
}

var _ session.Repository = (*Cached)(nil)

// NewCached wraps a store. ttl is the longest an entry may survive - see the
// note on store for what else shortens it.
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
func (c *Cached) ByToken(ctx context.Context, presented token.Token) (*session.Session, error) {
	// Inside a transaction the cache is not consulted at all. A use case that
	// read through it would be deciding on a copy taken before its transaction
	// began - a copy that transaction has never seen and cannot have locked -
	// and the write it goes on to make would be built on that.
	if sdkuow.HasTx(ctx) {
		return c.next.ByToken(ctx, presented)
	}

	key := tokenKey(presented)

	switch snapshot, err := sdkcache.GetJSON[dto.Snapshot](ctx, c.cache, key); {
	case err == nil:
		cached, err := snapshot.Session()
		if err == nil {
			return cached, nil
		}

		// Decoded, but not into a session this domain would have made - a
		// stored token that no longer parses, most likely. Drop it and ask the
		// database.
		_ = c.cache.Delete(ctx, key)

	case errors.Is(err, sdkcache.ErrMiss):
		// Nothing kept. The ordinary answer, not a failure.

	default:
		// Either the entry did not decode or the cache is unreachable, and both
		// are survivable because the database still is. The drop is best
		// effort: if the cache is the broken thing it will fail here too, which
		// is the same silence as the read.
		_ = c.cache.Delete(ctx, key)
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

	c.store(ctx, key, stored)

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

// Save writes through and forgets, in that order and also in the other.
//
// Forgetting first as well as last is not belt and braces. With only the drop
// after the write, a process that dies between the commit and it leaves the old
// entry behind for the rest of its ttl - and the old entry is the one that says
// a session somebody just revoked is still live.
func (c *Cached) Save(ctx context.Context, s *session.Session, events ...event.Event) error {
	// A session being inserted cannot be cached: its token was minted moments
	// ago and nothing has had the chance to ask for it.
	if s.Version == 0 {
		return c.next.Save(ctx, s, events...)
	}

	key := tokenKey(s.Token)
	_ = c.cache.Delete(ctx, key)

	if err := c.next.Save(ctx, s, events...); err != nil {
		return err
	}

	// The write is done. A failure to forget is not reported: telling a caller
	// their logout failed when it committed is the worse of the two lies, and
	// what the failure actually costs is a stale entry for the rest of its ttl.
	// That is the number to look at when deciding what the ttl should be.
	//
	// Called from inside somebody else's transaction this also runs before
	// their commit, so a read arriving in the gap can put the pre-commit copy
	// back. Same cost, same bound. Closing that window properly needs a hook
	// that runs after a transaction this repository did not open, and the
	// service has nowhere to hang one.
	_ = c.cache.Delete(ctx, key)

	return nil
}

// store keeps a session for the shorter of the configured ttl and what is left
// of the session's own life.
//
// The second bound is the one that matters: an entry outliving the session it
// describes would have this service holding an answer the database would no
// longer give, and expiry is the one way a session changes without anything
// running to notice. A session already past its expiry leaves a ttl of zero or
// less, and the cache stores nothing for one.
func (c *Cached) store(ctx context.Context, key string, s *session.Session) {
	ttl := c.ttl
	if left := s.ExpiresAt.Sub(c.now()); left < ttl {
		ttl = left
	}

	_ = sdkcache.SetJSON(ctx, c.cache, key, dto.NewSnapshot(s), ttl)
}

// tokenKey is the cache key for a token, and it hashes.
//
// The token is the credential itself. Built into a key, every live credential
// in the estate would be sitting in whatever a KEYS scan, a slow-log line or a
// redis dump ends up on - none of which is treated like a password store,
// because none of them is supposed to hold passwords. The hash is enough to
// find the entry again and no use to anybody who reads it.
func tokenKey(presented token.Token) string {
	sum := sha256.Sum256([]byte(presented.String()))

	return keyPrefix + hex.EncodeToString(sum[:])
}
