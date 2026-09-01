// Package logout ends a session.
package logout

import (
	"context"
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/logout/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
)

type UseCase struct {
	repo session.Repository
	now  func() time.Time
}

func New(repo session.Repository, now func() time.Time) *UseCase {
	return &UseCase{repo: repo, now: now}
}

// Handle revokes the session behind a token.
//
// A malformed or unknown token is not an error. The caller asked for there to
// be no session, and there is none; failing here would tell an attacker which
// tokens exist and would make a client's retry after a network timeout fail for
// no reason.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	presented, err := token.Parse(in.Token)
	if err != nil {
		return nil
	}
	sess, err := uc.repo.ByToken(ctx, presented)
	if errors.Is(err, session.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}

	ev, ended := sess.Revoke(event.ReasonLogout, uc.now())
	if !ended {
		// Already revoked. Nothing was written and nothing happened, so nothing
		// is announced.
		return nil
	}
	return uc.repo.Save(ctx, sess, ev)
}
