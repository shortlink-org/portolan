// Package policy holds the domain policies: rules of the form "when X has
// happened, do Y", where X and Y belong to different aggregates.
//
// This is the only package in the tree, apart from assembly, that knows both
// domains exist. Keeping the knowledge here is the point: session never imports
// user, user never imports session, and neither has to remember the other's
// rules.
package policy

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/end_after_credential_change"
	sessiondto "github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/end_after_credential_change/dto"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
)

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
	end *end_after_credential_change.UseCase
}

func New(end *end_after_credential_change.UseCase) *RevokeSessionsOnPasswordChange {
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
		UserID:    changed.UserID(),
		ChangedAt: changed.OccurredAt(),
		Keep:      changed.By(),
	})
}
