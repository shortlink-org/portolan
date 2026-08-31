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
// Nothing here evicts expired sessions. Expiry is a property of the aggregate,
// answered by Session.Validate at read time, so a session that has run out of
// time is refused whether or not anything got round to deleting it. A sweeper
// would be a space optimisation, not a rule.
type Memory struct {
	mu      sync.RWMutex
	byID    map[string]*session.Session
	byToken map[string]string // token -> session id
}

var _ session.Repository = (*Memory)(nil)

func NewMemory() *Memory {
	return &Memory{
		byID:    map[string]*session.Session{},
		byToken: map[string]string{},
	}
}

func (m *Memory) Save(_ context.Context, s *session.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.byID[s.ID] = s
	m.byToken[s.Token.String()] = s.ID
	return nil
}

func (m *Memory) ByID(_ context.Context, id string) (*session.Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s, ok := m.byID[id]
	if !ok {
		return nil, session.ErrNotFound
	}
	return s, nil
}

func (m *Memory) ByToken(_ context.Context, presented token.Token) (*session.Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	id, ok := m.byToken[presented.String()]
	if !ok {
		return nil, session.ErrNotFound
	}
	return m.byID[id], nil
}
