// Package get reads a single user by id.
package get

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/get/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
)

type UseCase struct {
	repo user.Repository
}

func New(repo user.Repository) *UseCase {
	return &UseCase{repo: repo}
}

// Handle returns the user, or user.ErrNotFound. Unlike authenticate, this one
// may say "no such user": the caller already knows the id, so nothing is
// disclosed by admitting it does not exist.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	u, err := uc.repo.ByID(ctx, in.UserID)
	if err != nil {
		return dto.Output{}, err
	}
	return dto.Output{
		UserID:    u.ID,
		Email:     u.Email.String(),
		CreatedAt: u.CreatedAt,
	}, nil
}
