// Package user holds the adapters for the user aggregate's storage port.
//
// Everything here implements domain/user.Repository and nothing else. The
// dependency runs one way - infrastructure knows the domain, the domain does
// not know this package exists.
package user

import (
	"context"
	"strings"
	"sync"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
)

// Memory keeps users in a map. It is the adapter the tests and
// `cmd/auth -store=memory` run on; it is not a cache in front of anything.
//
// Everything crossing its edge is cloned, in both directions. A store that
// handed out the object it holds would let a caller change stored state without
// saving - something no real database does, which is exactly why an in-memory
// adapter that allows it makes tests pass where production would not.
type Memory struct {
	mu     sync.RWMutex
	byID   map[string]*user.User
	byMail map[string]string // normalised email -> user id
}

// Compile-time proof that the port is satisfied. Without it a signature drift
// only shows up wherever the adapter happens to be wired.
var _ user.Repository = (*Memory)(nil)

func NewMemory() *Memory {
	return &Memory{
		byID:   map[string]*user.User{},
		byMail: map[string]string{},
	}
}

func key(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// Save writes the user, if nobody has changed it since this copy was read.
//
// The uniqueness of an address is checked here rather than on the aggregate,
// because it is the only place that can see every user - one User cannot know
// about the others. A real database would state the same rule as a unique
// index and this method would map the violation onto the same error.
//
// It does not touch the aggregate it was given, version included. So saving the
// same object twice is a conflict the second time: after the first write the
// stored version has moved on and the copy in hand is stale. That is the same
// check that catches two writers racing, and it is not softened just because
// the second writer happens to be the same code.
func (m *Memory) Save(_ context.Context, u *user.User) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if stored, exists := m.byID[u.ID]; exists && stored.Version != u.Version {
		return user.ErrConflict
	} else if !exists && u.Version != 0 {
		// A version on something the store has never seen means it was written
		// and then removed, or that it came from another store.
		return user.ErrConflict
	}

	email := key(u.Email.String())
	if id, taken := m.byMail[email]; taken && id != u.ID {
		return user.ErrEmailTaken
	}

	written := u.Clone()
	written.Version = u.Version + 1
	m.byID[u.ID] = written
	m.byMail[email] = u.ID
	return nil
}

func (m *Memory) ByID(_ context.Context, id string) (*user.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	u, ok := m.byID[id]
	if !ok {
		return nil, user.ErrNotFound
	}
	return u.Clone(), nil
}

func (m *Memory) ByEmail(_ context.Context, email string) (*user.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	id, ok := m.byMail[key(email)]
	if !ok {
		return nil, user.ErrNotFound
	}
	return m.byID[id].Clone(), nil
}
