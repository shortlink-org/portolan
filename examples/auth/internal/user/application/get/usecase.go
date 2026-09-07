// Package get reads a single user by id.
package get

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
)

type UseCase struct {
	repo user.Repository
}

func New(repo user.Repository) *UseCase {
	return &UseCase{repo: repo}
}

// Handle returns the user, or user.ErrNotFound. Unlike check_credentials, this one
// may say "no such user": the caller already knows the id, so nothing is
// disclosed by admitting it does not exist.
func (uc *UseCase) Handle(ctx context.Context, in Query) (Result, error) {
	u, err := uc.repo.ByID(ctx, in.UserID)
	if err != nil {
		return Result{}, err
	}
	return Result{
		UserID:    u.ID,
		Email:     u.Email.String(),
		CreatedAt: u.CreatedAt,
	}, nil
}
