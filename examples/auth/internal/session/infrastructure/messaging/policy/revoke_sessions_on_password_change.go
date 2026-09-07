// Package policy holds the session module's reactions to integration events.
//
// This is the only package in the session module, apart from assembly and the
// identity adapter, that knows user exists. Keeping the knowledge here is the
// point: session domain/application never import user, user domain/application
// never import session, and neither aggregate has to remember the other's
// rules.
package policy

import (
	"context"

	sessiondto "github.com/shortlink-org/portolan/examples/auth/internal/session/application/end_after_credential_change/dto"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/user/integration/event"
)

// SessionEnder is the only application capability this policy needs. Keeping
// the port here makes the policy independently testable and avoids coupling an
// integration-event adapter to a concrete use-case implementation.
type SessionEnder interface {
	Handle(ctx context.Context, in sessiondto.Input) error
}

// RevokeSessionsOnPasswordChange ends the sessions issued against a password
// that has just been replaced.
//
// It hangs off the FACT rather than off the use case that produced it. Every
// way a password can change - the owner changing it, a support reset, an import
// from an old system - publishes the same event, and each of them gets this
// behaviour without asking for it. Written as a call inside the change-password
// flow instead, the rule would have to be remembered again at every new way in,
// and the one that forgot would silently not have it.
type RevokeSessionsOnPasswordChange struct {
	end SessionEnder
}

func New(end SessionEnder) *RevokeSessionsOnPasswordChange {
	return &RevokeSessionsOnPasswordChange{end: end}
}

// Handle reacts to one event. Anything else on the bus is not this policy's
// business and is passed over rather than treated as an error.
//
// The session spared is the one the change was made from, carried on the event
// as `By`. An administrative reset leaves it empty and spares nothing, which is
// what a reset is for.
func (p *RevokeSessionsOnPasswordChange) Handle(ctx context.Context, e userevent.Event) error {
	changed, ok := e.(userevent.PasswordChanged)
	if !ok {
		return nil
	}

	return p.end.Handle(ctx, sessiondto.Input{
		UserID:    changed.UserID,
		ChangedAt: changed.OccurredAt,
		Keep:      changed.By,
	})
}
