// Package check answers whether an account accepts a password right now.
package check

import (
	"context"
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/lockout/usecases/check/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout"
)

type UseCase struct {
	repo lockout.Repository
	now  func() time.Time
}

func New(repo lockout.Repository, now func() time.Time) *UseCase {
	return &UseCase{repo: repo, now: now}
}

// Handle reads and answers. It writes nothing: asking whether an account is
// locked is not an attempt on it.
//
// A user with no lockout has never typed a wrong password, and is allowed.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	l, err := uc.repo.ByUserID(ctx, in.UserID)
	if errors.Is(err, lockout.ErrNotFound) {
		return dto.Output{Allowed: true}, nil
	}
	if err != nil {
		return dto.Output{}, err
	}
	return dto.Output{Allowed: l.Allows(uc.now())}, nil
}
