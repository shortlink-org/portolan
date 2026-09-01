package dto

import (
	"fmt"
	"time"

	domain "github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
)

// Snapshot is the shape a session takes in the cache.
//
// It is a separate type from the aggregate for the same reason the events have
// one: what is written down outlives the build that wrote it. A field renamed
// in the domain must not silently change what an older process still holding
// entries can read, and a Snapshot that no longer parses is caught here rather
// than three layers up.
//
// Nothing here encodes. The cache's GetJSON and SetJSON do that, so this file
// is only about shape and translation - which is all a dto in this service ever
// is.
type Snapshot struct {
	ID        string     `json:"id"`
	UserID    string     `json:"userId"`
	Token     string     `json:"token"`
	IssuedAt  time.Time  `json:"issuedAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`

	// Version travels with the rest of it. A cached copy is a copy taken at a
	// version, and a write made from one is refused if the store has moved on -
	// which is what makes it safe to read a session from anywhere at all.
	Version int64 `json:"version"`
}

// NewSnapshot takes the copy that goes into the cache.
func NewSnapshot(s *domain.Session) Snapshot {
	snapshot := Snapshot{
		ID:        s.ID,
		UserID:    s.UserID,
		Token:     s.Token.String(),
		IssuedAt:  s.IssuedAt,
		ExpiresAt: s.ExpiresAt,
		Version:   s.Version,
	}
	if !s.RevokedAt.IsZero() {
		revoked := s.RevokedAt
		snapshot.RevokedAt = &revoked
	}

	return snapshot
}

// Session rebuilds the aggregate from what was cached.
//
// The token goes back through the parser rather than being assigned, exactly as
// the row scanner does it: an entry that is not shaped like one of ours is a
// broken entry, and handing back a Session the domain would never have made is
// worse than saying so and going to the database.
func (s Snapshot) Session() (*domain.Session, error) {
	parsed, err := token.Parse(s.Token)
	if err != nil {
		return nil, fmt.Errorf("dto: cached token of %s is not one: %w", s.ID, err)
	}

	rebuilt := &domain.Session{
		ID:        s.ID,
		UserID:    s.UserID,
		Token:     parsed,
		IssuedAt:  s.IssuedAt,
		ExpiresAt: s.ExpiresAt,
		Version:   s.Version,
	}
	if s.RevokedAt != nil {
		rebuilt.RevokedAt = *s.RevokedAt
	}

	return rebuilt, nil
}
