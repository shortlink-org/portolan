package session_test

import (
	"context"
	"errors"
	"testing"
	"time"

	sdkcache "github.com/shortlink-org/go-sdk/cache"

	domain "github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/redistest"
)

// One test against a real redis, and it is not about redis: the SDK's adapter
// has its own tests, next to itself. What is only true here is that a session
// survives the round trip through what this service actually stores - the
// snapshot, encoded by the cache, under a key this file's hashing produced -
// and that revoking one really does remove it from a server rather than from a
// map that agrees with us.

func TestCachedThroughARealRedis(t *testing.T) {
	ctx := context.Background()
	sess := newSession(t, "s1", "u1", now)
	sess.Version = 1

	store := newFakeStore(sess)
	repository := repo.NewCached(store, redistest.Cache(t), cacheTTL, func() time.Time { return now })

	first, err := repository.ByToken(ctx, sess.Token)
	if err != nil || first.ID != "s1" {
		t.Fatalf("ByToken = %v, %v", first, err)
	}

	second, err := repository.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatal(err)
	}
	if store.reads != 1 {
		t.Errorf("the second read reached the store; reads = %d", store.reads)
	}

	// Everything the caller might use has to come back, and come back the same.
	// A snapshot that lost the version would produce writes the store refuses;
	// one that lost the expiry would produce sessions that never end.
	if second.UserID != sess.UserID || second.Version != sess.Version {
		t.Errorf("round trip = %+v, want %+v", second, sess)
	}
	if !second.Token.Equal(sess.Token) {
		t.Error("the token did not survive the round trip")
	}
	if !second.ExpiresAt.Equal(sess.ExpiresAt) || !second.IssuedAt.Equal(sess.IssuedAt) {
		t.Errorf("times did not survive the round trip: %+v", second)
	}
	if !second.RevokedAt.IsZero() {
		t.Error("a session that was never revoked came back with a revocation time")
	}

	ev, ended := second.Revoke(event.ReasonLogout, now)
	if !ended {
		t.Fatal("a live session refused to be revoked")
	}
	if err := repository.Save(ctx, second, ev); err != nil {
		t.Fatal(err)
	}

	after, err := repository.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatal(err)
	}
	if store.reads != 2 {
		t.Errorf("the read after the revocation was served from the cache; reads = %d", store.reads)
	}
	if err := after.Validate(now); !errors.Is(err, domain.ErrRevoked) {
		t.Errorf("Validate = %v, want ErrRevoked", err)
	}
}

func TestCachedKeepsNothingItCannotStore(t *testing.T) {
	ctx := context.Background()

	// Already expired: the ttl works out at zero or less, and the cache refuses
	// to store an entry without an expiry rather than keeping it forever.
	expired := newSession(t, "s1", "u1", now.Add(-domain.TTL-time.Minute))
	expired.Version = 1

	store := newFakeStore(expired)
	memory := redistest.Cache(t)
	repository := repo.NewCached(store, memory, cacheTTL, func() time.Time { return now })

	for range 2 {
		if _, err := repository.ByToken(ctx, expired.Token); err != nil {
			t.Fatal(err)
		}
	}
	if store.reads != 2 {
		t.Errorf("reads = %d, want 2: an expired session must not be kept", store.reads)
	}

	// And the same question asked of the cache directly, so that a decorator
	// which quietly stopped reading would not pass this.
	if _, err := sdkcache.GetJSON[map[string]any](ctx, memory, "auth:session:token:"+t.Name()); !errors.Is(err, sdkcache.ErrMiss) {
		t.Errorf("Get = %v, want ErrMiss", err)
	}
}
