package session_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	sdkcache "github.com/shortlink-org/go-sdk/cache"
	sdkuow "github.com/shortlink-org/go-sdk/uow"

	domain "github.com/shortlink-org/portolan/examples/auth/internal/session/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/vo/token"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/repository"
)

// cacheTTL is what the decorator is given in these tests. Every session here
// has a day left, so it is always the shorter of the two bounds - except in the
// test that is about the other one.
const cacheTTL = time.Minute

// These tests drive Mockery-generated ports. The small state objects below do
// not implement production interfaces; they only supply stateful answers to
// mock expectations so race and failure scenarios remain readable.
type storeState struct {
	mock     *MockRepository
	sessions map[string]*domain.Session // by token
	reads    int
	saves    int
	err      error

	// afterRead runs inside ByToken, after the row was read and before it is
	// returned. It is how a test stands in the gap where a reader has the
	// store's answer and has not yet cached it.
	afterRead func()
}

func newMockStore(t *testing.T, sessions ...*domain.Session) *storeState {
	t.Helper()
	s := &storeState{mock: NewMockRepository(t), sessions: map[string]*domain.Session{}}
	for _, sess := range sessions {
		s.sessions[sess.Token.String()] = sess
	}

	s.mock.EXPECT().ByToken(mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, presented token.Token) (*domain.Session, error) {
			s.reads++
			if s.err != nil {
				return nil, s.err
			}
			found, ok := s.sessions[presented.String()]
			if !ok {
				return nil, domain.ErrNotFound
			}
			read := found.Clone()
			if s.afterRead != nil {
				s.afterRead()
			}
			return read, nil
		}).Maybe()
	s.mock.EXPECT().ByID(mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, id string) (*domain.Session, error) {
			s.reads++
			for _, sess := range s.sessions {
				if sess.ID == id {
					return sess.Clone(), nil
				}
			}
			return nil, domain.ErrNotFound
		}).Maybe()
	s.mock.EXPECT().ByUserID(mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, userID string) ([]*domain.Session, error) {
			s.reads++
			out := []*domain.Session{}
			for _, sess := range s.sessions {
				if sess.UserID == userID {
					out = append(out, sess.Clone())
				}
			}
			return out, nil
		}).Maybe()
	save := func(_ context.Context, sess *domain.Session, _ ...event.Event) error {
		s.saves++
		if s.err != nil {
			return s.err
		}
		stored := sess.Clone()
		stored.Version++
		s.sessions[stored.Token.String()] = stored
		return nil
	}
	s.mock.EXPECT().Save(mock.Anything, mock.Anything).RunAndReturn(save).Maybe()
	s.mock.EXPECT().Save(mock.Anything, mock.Anything, mock.Anything).RunAndReturn(save).Maybe()

	return s
}

// cacheState records what the generated cache mock was asked to do. broken makes every
// operation fail, which is the interesting state: a cache that is down.
// deletesBroken fails only the drops, which is the dangerous one: a cache
// that keeps answering while refusing to forget.
type cacheState struct {
	mock          *MockCache
	entries       map[string][]byte
	ttls          map[string]time.Duration
	deletes       int
	broken        bool
	deletesBroken bool
}

var errBroken = errors.New("cache is down")

func newMockCache(t *testing.T) *cacheState {
	t.Helper()
	c := &cacheState{
		mock:    NewMockCache(t),
		entries: map[string][]byte{},
		ttls:    map[string]time.Duration{},
	}
	c.mock.EXPECT().Get(mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, key string) ([]byte, error) {
			if c.broken {
				return nil, errBroken
			}
			value, ok := c.entries[key]
			if !ok {
				return nil, sdkcache.ErrMiss
			}
			return value, nil
		}).Maybe()
	c.mock.EXPECT().Set(mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, key string, value []byte, ttl time.Duration) error {
			if c.broken {
				return errBroken
			}
			c.entries[key] = value
			c.ttls[key] = ttl
			return nil
		}).Maybe()
	c.mock.EXPECT().Delete(mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, keys ...string) error {
			c.deletes++
			if c.broken || c.deletesBroken {
				return errBroken
			}
			for _, key := range keys {
				delete(c.entries, key)
			}
			return nil
		}).Maybe()
	return c
}

// The two kinds of entry the decorator keeps, told apart by prefix. That the
// tests know the prefixes and nothing else about a key is deliberate: which of
// the two a write produced is the thing under test, and how a token becomes
// the rest of the key - hashed - is the decorator's business.
const (
	livePrefix    = "auth:session:token:"
	revokedPrefix = "auth:session:revoked:"
)

// live counts the entries that hold a session.
func (c *cacheState) live() int {
	return c.count(livePrefix)
}

// revoked counts the entries that record a revocation.
func (c *cacheState) revoked() int {
	return c.count(revokedPrefix)
}

func (c *cacheState) count(prefix string) int {
	n := 0
	for key := range c.entries {
		if strings.HasPrefix(key, prefix) {
			n++
		}
	}

	return n
}

// ttlOf returns the ttl of the single entry under a prefix.
func (c *cacheState) ttlOf(t *testing.T, prefix string) time.Duration {
	t.Helper()

	if c.count(prefix) != 1 {
		t.Fatalf("the cache holds %d entries under %s, want 1", c.count(prefix), prefix)
	}
	for key, ttl := range c.ttls {
		if strings.HasPrefix(key, prefix) {
			return ttl
		}
	}

	return 0
}

func cached(store *storeState, memory *cacheState) *repo.Cached {
	return repo.NewCached(store.mock, memory.mock, cacheTTL, func() time.Time { return now })
}

func TestCachedSecondReadDoesNotReachTheStore(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	repository := cached(store, memory)

	first, err := repository.ByToken(ctx, sess.Token)
	if err != nil || first.ID != "s1" {
		t.Fatalf("ByToken = %v, %v", first, err)
	}
	if store.reads != 1 {
		t.Fatalf("the first read went to the store %d times, want 1", store.reads)
	}

	second, err := repository.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatalf("ByToken = %v", err)
	}
	if store.reads != 1 {
		t.Errorf("the second read reached the store; reads = %d", store.reads)
	}

	// The copy that came back from the cache has to be the session, not a
	// half of it: a use case that revokes what it read needs the version.
	if second.ID != sess.ID || second.UserID != sess.UserID || second.Version != sess.Version {
		t.Errorf("cached copy = %+v, want %+v", second, sess)
	}
	if !second.Token.Equal(sess.Token) {
		t.Error("the cached copy came back with a different token")
	}
	if !second.ExpiresAt.Equal(sess.ExpiresAt) || !second.IssuedAt.Equal(sess.IssuedAt) {
		t.Errorf("times did not survive the round trip: %+v", second)
	}
}

func TestCachedRevocationIsNotServedFromTheCache(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	repository := cached(store, memory)

	live, err := repository.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatal(err)
	}

	ev, ended := live.Revoke(event.ReasonLogout, now)
	if !ended {
		t.Fatal("a live session refused to be revoked")
	}
	if err := repository.Save(ctx, live, ev); err != nil {
		t.Fatal(err)
	}
	if memory.live() != 0 {
		t.Fatalf("the cache still holds %d live copies after a revocation", memory.live())
	}
	if memory.revoked() != 1 {
		t.Fatalf("the cache holds %d revocations after a revocation, want 1", memory.revoked())
	}

	after, err := repository.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatal(err)
	}
	if after.RevokedAt.IsZero() {
		t.Error("the read after the revocation still says the session is live")
	}
	if err := after.Validate(now); !errors.Is(err, domain.ErrRevoked) {
		t.Errorf("Validate = %v, want ErrRevoked", err)
	}

	// And it stays that way: a revoked token is read from the store for the
	// rest of its life, and nothing about it is kept.
	if _, err := repository.ByToken(ctx, sess.Token); err != nil {
		t.Fatal(err)
	}
	if store.reads != 3 {
		t.Errorf("reads = %d, want 3: every read of a revoked token is the store's", store.reads)
	}
	if memory.live() != 0 {
		t.Error("a revoked session was cached")
	}
}

func TestCachedRevocationBeatsAReaderThatLostTheRace(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	repository := cached(store, memory)

	// The reader has the store's answer - live - in hand. Before it can cache
	// it, the session is revoked through the same repository. Dropping the
	// entry cannot help here: there is nothing to drop yet.
	store.afterRead = func() {
		store.afterRead = nil

		revoking := sess.Clone()
		ev, ended := revoking.Revoke(event.ReasonLogout, now)
		if !ended {
			t.Fatal("a live session refused to be revoked")
		}
		if err := repository.Save(ctx, revoking, ev); err != nil {
			t.Fatal(err)
		}
	}

	// The reader is right, for its moment: the revocation had not happened
	// when it read.
	racer, err := repository.ByToken(ctx, sess.Token)
	if err != nil || !racer.RevokedAt.IsZero() {
		t.Fatalf("ByToken = %v, %v, want the live copy the reader was handed", racer, err)
	}

	// Whatever the reader put in the cache, the next read is not answered
	// from it.
	after, err := repository.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatal(err)
	}
	if err := after.Validate(now); !errors.Is(err, domain.ErrRevoked) {
		t.Errorf("Validate = %v, want ErrRevoked: the copy the racing reader cached was served", err)
	}
}

func TestCachedRevocationSurvivesADropThatFailed(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	repository := cached(store, memory)

	live, err := repository.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatal(err)
	}

	// The cache keeps answering but will not forget.
	memory.deletesBroken = true

	ev, ended := live.Revoke(event.ReasonLogout, now)
	if !ended {
		t.Fatal("a live session refused to be revoked")
	}
	if err := repository.Save(ctx, live, ev); err != nil {
		t.Fatalf("Save = %v; a write must not fail because the cache cannot be told", err)
	}
	if memory.live() != 1 {
		t.Fatalf("the failed drop removed the entry after all; live = %d", memory.live())
	}

	after, err := repository.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatal(err)
	}
	if err := after.Validate(now); !errors.Is(err, domain.ErrRevoked) {
		t.Errorf("Validate = %v, want ErrRevoked: the copy the drop could not remove was served", err)
	}
}

func TestCachedRevocationIsKeptBeforeTheStoreIsAsked(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	repository := cached(store, memory)

	live, err := repository.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatal(err)
	}

	store.err = errors.New("the database said no")
	ev, _ := live.Revoke(event.ReasonLogout, now)
	if err := repository.Save(ctx, live, ev); err == nil {
		t.Fatal("Save = nil, want the store's error")
	}

	// The revocation is in the cache although the store refused it. That is
	// the order that survives a process dying after the commit, and what it
	// costs is one session that is read from the store instead of the cache.
	if memory.revoked() != 1 {
		t.Fatalf("revocations = %d, want 1: the entry has to be written before the store is asked", memory.revoked())
	}

	store.err = nil
	for range 2 {
		got, err := repository.ByToken(ctx, sess.Token)
		if err != nil || !got.RevokedAt.IsZero() {
			t.Fatalf("ByToken = %v, %v, want the live session the store still holds", got, err)
		}
	}
	if store.reads != 3 {
		t.Errorf("reads = %d, want 3: a token with a revocation on record is never answered from the cache", store.reads)
	}
	if memory.live() != 0 {
		t.Error("a token with a revocation on record was cached")
	}
}

func TestCachedRevocationLivesAsLongAsTheSessionWouldHave(t *testing.T) {
	ctx := context.Background()

	// Half a minute of life left, and the cache is allowed a minute for a live
	// copy. The revocation is bound by the session alone.
	left := 30 * time.Second
	sess := newSession(t, "s1", "u1", now.Add(-domain.TTL+left))
	sess.Version = 1
	memory := newMockCache(t)
	repository := cached(newMockStore(t, sess), memory)

	ev, _ := sess.Revoke(event.ReasonLogout, now)
	if err := repository.Save(ctx, sess, ev); err != nil {
		t.Fatal(err)
	}
	if ttl := memory.ttlOf(t, revokedPrefix); ttl != left {
		t.Errorf("ttl of the revocation = %s, want %s: what is left of the session", ttl, left)
	}

	// Already past its expiry: the store refuses it on its own, and nothing
	// live is ever kept for it, so there is nothing to record.
	expired := newSession(t, "s2", "u1", now.Add(-domain.TTL-time.Minute))
	expired.Version = 1
	ev, _ = expired.Revoke(event.ReasonLogout, now)
	if err := repository.Save(ctx, expired, ev); err != nil {
		t.Fatal(err)
	}
	if memory.revoked() != 1 {
		t.Errorf("revocations = %d, want 1: revoking an expired session records nothing", memory.revoked())
	}
}

func TestCachedKeepsNothingThatIsRevoked(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	sess.Revoke(event.ReasonLogout, now)
	memory := newMockCache(t)
	repository := cached(newMockStore(t, sess), memory)

	got, err := repository.ByToken(ctx, sess.Token)
	if err != nil || got.RevokedAt.IsZero() {
		t.Fatalf("ByToken = %v, %v, want the revoked session", got, err)
	}
	if len(memory.entries) != 0 {
		t.Error("a session the store says is revoked was cached")
	}
}

func TestCachedSaveForgetsBeforeAndAfterTheWrite(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	memory := newMockCache(t)
	repository := cached(newMockStore(t, sess), memory)

	if err := repository.Save(ctx, sess); err != nil {
		t.Fatal(err)
	}

	// Twice: the drop before the write is what survives a process that dies
	// after the commit, and the one after it is what survives a reader that
	// repopulated the entry while the write was in flight.
	if memory.deletes != 2 {
		t.Errorf("the write dropped the entry %d times, want 2", memory.deletes)
	}
}

func TestCachedInsertLeavesTheCacheAlone(t *testing.T) {
	ctx := context.Background()
	fresh := newSession(t, "s1", "u1", now) // version 0: never stored
	memory := newMockCache(t)
	repository := cached(newMockStore(t), memory)

	if err := repository.Save(ctx, fresh); err != nil {
		t.Fatal(err)
	}
	if memory.deletes != 0 {
		t.Errorf("inserting a session dropped %d cache entries; its token is new", memory.deletes)
	}
}

func TestCachedFailedWriteLeavesNothingBehind(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	repository := cached(store, memory)

	if _, err := repository.ByToken(ctx, sess.Token); err != nil {
		t.Fatal(err)
	}

	store.err = errors.New("the database said no")
	if err := repository.Save(ctx, sess); err == nil {
		t.Fatal("Save = nil, want the store's error")
	}

	// The write did not happen, so the cache is merely empty rather than wrong.
	// Dropping an entry that turned out not to need dropping costs one read.
	if len(memory.entries) != 0 {
		t.Error("a failed write left the pre-write copy in the cache")
	}
}

func TestCachedSurvivesACacheThatIsDown(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	memory.broken = true
	repository := cached(store, memory)

	for range 2 {
		got, err := repository.ByToken(ctx, sess.Token)
		if err != nil || got.ID != "s1" {
			t.Fatalf("ByToken = %v, %v; a cache that is down must not take the read with it", got, err)
		}
	}
	if store.reads != 2 {
		t.Errorf("reads = %d, want 2: every read has to fall through", store.reads)
	}

	if err := repository.Save(ctx, sess); err != nil {
		t.Errorf("Save = %v; a write must not fail because the cache cannot be told", err)
	}
}

func TestCachedDropsAnEntryItCannotRead(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	repository := cached(store, memory)

	if _, err := repository.ByToken(ctx, sess.Token); err != nil {
		t.Fatal(err)
	}

	// Whatever an older build, or a different service, left under the key.
	for key := range memory.entries {
		memory.entries[key] = []byte(`{"id":`)
	}

	got, err := repository.ByToken(ctx, sess.Token)
	if err != nil || got.ID != "s1" {
		t.Fatalf("ByToken = %v, %v, want the session from the store", got, err)
	}
	if memory.deletes == 0 {
		t.Error("the unreadable entry was left where it was")
	}
}

func TestCachedKeepsNothingForAnUnknownToken(t *testing.T) {
	ctx := context.Background()
	stranger, err := token.New()
	if err != nil {
		t.Fatal(err)
	}
	store := newMockStore(t)
	memory := newMockCache(t)
	repository := cached(store, memory)

	for range 2 {
		if _, err := repository.ByToken(ctx, stranger); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("ByToken = %v, want ErrNotFound", err)
		}
	}
	if len(memory.entries) != 0 {
		t.Error("a token nobody has ever seen was cached")
	}
	if store.reads != 2 {
		t.Errorf("reads = %d, want 2", store.reads)
	}
}

func TestCachedEntryNeverOutlivesItsSession(t *testing.T) {
	ctx := context.Background()

	// Issued nearly a whole TTL ago: half a minute of life left, and the cache
	// is allowed a minute.
	left := 30 * time.Second
	sess := newSession(t, "s1", "u1", now.Add(-domain.TTL+left))
	sess.Version = 1
	memory := newMockCache(t)
	repository := cached(newMockStore(t, sess), memory)

	if _, err := repository.ByToken(ctx, sess.Token); err != nil {
		t.Fatal(err)
	}
	if ttl := memory.ttlOf(t, livePrefix); ttl != left {
		t.Errorf("ttl of the live copy = %s, want %s: what is left of the session", ttl, left)
	}
}

func TestCachedKeepsNothingThatHasAlreadyExpired(t *testing.T) {
	ctx := context.Background()
	expired := newSession(t, "s1", "u1", now.Add(-domain.TTL-time.Minute))
	expired.Version = 1
	memory := newMockCache(t)
	repository := cached(newMockStore(t, expired), memory)

	if _, err := repository.ByToken(ctx, expired.Token); err != nil {
		t.Fatal(err)
	}
	if len(memory.entries) != 0 {
		t.Error("a session that is already past its expiry was cached")
	}
}

func TestCachedIsNotConsultedInsideATransaction(t *testing.T) {
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	repository := cached(store, memory)

	// Warm it, outside the transaction.
	if _, err := repository.ByToken(context.Background(), sess.Token); err != nil {
		t.Fatal(err)
	}

	txCtx := sdkuow.WithTx(context.Background(), NewMockTx(t))
	if _, err := repository.ByToken(txCtx, sess.Token); err != nil {
		t.Fatal(err)
	}
	if store.reads != 2 {
		t.Errorf("reads = %d, want 2: a read inside a transaction has to be the transaction's", store.reads)
	}
}

func TestCachedReadsThatAreNotHotGoStraightThrough(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1
	store := newMockStore(t, sess)
	memory := newMockCache(t)
	repository := cached(store, memory)

	for range 2 {
		if _, err := repository.ByID(ctx, "s1"); err != nil {
			t.Fatal(err)
		}
		if _, err := repository.ByUserID(ctx, "u1"); err != nil {
			t.Fatal(err)
		}
	}
	if store.reads != 4 {
		t.Errorf("reads = %d, want 4: neither ByID nor ByUserID is cached", store.reads)
	}
	if len(memory.entries) != 0 {
		t.Errorf("the cache holds %d entries; only ByToken puts anything there", len(memory.entries))
	}
}
