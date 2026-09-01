// Package validate answers whether a token is still good, and whose it is.
//
// This is the hot path: every authenticated request in the estate ends here, so
// it takes no Publisher and writes nothing.
package validate

import (
	"context"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/validate/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
)

type UseCase struct {
	repo session.Repository
	now  func() time.Time
}

func New(repo session.Repository, now func() time.Time) *UseCase {
	return &UseCase{repo: repo, now: now}
}

// Handle resolves a token to a live session. A malformed token is reported as
// session.ErrNotFound rather than as a parse failure: outside auth, "this token
// is not shaped like one of ours" and "we have never seen it" are the same
// answer, and telling them apart only helps someone probing the format.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	presented, err := token.Parse(in.Token)
	if err != nil {
		return dto.Output{}, session.ErrNotFound
	}
	sess, err := uc.repo.ByToken(ctx, presented)
	if err != nil {
		return dto.Output{}, err
	}
	if err := sess.Validate(uc.now()); err != nil {
		return dto.Output{}, err
	}
	return dto.Output{
		UserID:    sess.UserID,
		ExpiresAt: sess.ExpiresAt,
		SessionID: sess.ID,
	}, nil
}
