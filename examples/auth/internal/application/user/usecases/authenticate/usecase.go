// Package authenticate holds the credential check: does this address and
// password belong to a user, and which one.
//
// It issues nothing. Turning a checked credential into a session is the session
// domain's job.
package authenticate

import (
	"context"
	"errors"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/authenticate/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email"
)

type UseCase struct {
	repo user.Repository
}

func New(repo user.Repository) *UseCase {
	return &UseCase{repo: repo}
}

// Handle checks the credentials. Every failure - malformed address, unknown
// address, wrong password - comes back as user.ErrInvalidCredentials, so the
// answer does not say which addresses are registered.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	address, err := email.New(in.Email)
	if err != nil {
		return dto.Output{}, user.ErrInvalidCredentials
	}
	u, err := uc.repo.ByEmail(ctx, address.String())
	if errors.Is(err, user.ErrNotFound) {
		return dto.Output{}, user.ErrInvalidCredentials
	}
	if err != nil {
		return dto.Output{}, err
	}
	if err := u.Authenticate(in.Password); err != nil {
		return dto.Output{}, err
	}
	return dto.Output{UserID: u.ID}, nil
}
