// Package check answers whether an account accepts a password right now.
package check

import (
	"context"
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/domain"
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
func (uc *UseCase) Handle(ctx context.Context, in Query) (Result, error) {
	l, err := uc.repo.ByUserID(ctx, in.UserID)
	if errors.Is(err, lockout.ErrNotFound) {
		return Result{Allowed: true}, nil
	}
	if err != nil {
		return Result{}, err
	}
	return Result{Allowed: l.Allows(uc.now())}, nil
}
