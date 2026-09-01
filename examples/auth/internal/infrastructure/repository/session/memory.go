// Package session holds the adapters for the session aggregate's storage port.
package session

import (
	"context"
	"sync"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
)

// Memory keeps sessions in a map, indexed twice: by id, and by token for the
// read path every authenticated request goes through.
//
// Everything crossing its edge is cloned, in both directions - see the note on
// the user adapter.
//
// Nothing here evicts expired sessions. Expiry is a property of the aggregate,
// answered by Session.Validate at read time, so a session that has run out of
// time is refused whether or not anything got round to deleting it. A sweeper
// would be a space optimisation, not a rule.
type Memory struct {
	mu      sync.RWMutex
	byID    map[string]*session.Session
	byToken map[string]string   // token -> session id
	byUser  map[string][]string // user id -> session ids, in the order issued
}

var _ session.Repository = (*Memory)(nil)

func NewMemory() *Memory {
	return &Memory{
		byID:    map[string]*session.Session{},
		byToken: map[string]string{},
		byUser:  map[string][]string{},
	}
}

// Save writes the session, if nobody has changed it since this copy was read.
// See the note on the user adapter for why saving the same object twice is a
// conflict.
func (m *Memory) Save(_ context.Context, s *session.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if stored, exists := m.byID[s.ID]; exists && stored.Version != s.Version {
		return session.ErrConflict
	} else if !exists && s.Version != 0 {
		return session.ErrConflict
	}

	_, existed := m.byID[s.ID]

	written := s.Clone()
	written.Version = s.Version + 1
	m.byID[s.ID] = written
	m.byToken[s.Token.String()] = s.ID
	if !existed {
		m.byUser[s.UserID] = append(m.byUser[s.UserID], s.ID)
	}
	return nil
}

func (m *Memory) ByID(_ context.Context, id string) (*session.Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s, ok := m.byID[id]
	if !ok {
		return nil, session.ErrNotFound
	}
	return s.Clone(), nil
}

func (m *Memory) ByToken(_ context.Context, presented token.Token) (*session.Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	id, ok := m.byToken[presented.String()]
	if !ok {
		return nil, session.ErrNotFound
	}
	return m.byID[id].Clone(), nil
}

// ByUserID returns every session of a user, in the order they were issued.
//
// An unknown user is an empty list rather than ErrNotFound: this answers "what
// has this user got open", and the answer for somebody with nothing open is
// nothing, not an error.
func (m *Memory) ByUserID(_ context.Context, userID string) ([]*session.Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ids := m.byUser[userID]
	out := make([]*session.Session, 0, len(ids))
	for _, id := range ids {
		if s, ok := m.byID[id]; ok {
			out = append(out, s.Clone())
		}
	}
	return out, nil
}
