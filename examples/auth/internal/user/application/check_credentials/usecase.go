// Package check_credentials holds the credential check: does this address and
// password belong to a user, and which one.
//
// It issues nothing. Turning a checked credential into a session is the session
// domain's job.
package check_credentials

import (
	"context"
	"errors"

	userapplication "github.com/shortlink-org/portolan/examples/auth/internal/user/application"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/check_credentials/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/email"
)

type UseCase struct {
	repo     user.Repository
	lockout  Lockout
	verifier PasswordVerifier
}

func New(repo user.Repository, lockout Lockout, verifier PasswordVerifier) *UseCase {
	return &UseCase{repo: repo, lockout: lockout, verifier: verifier}
}

// Handle checks the credentials. Every failure - malformed address, unknown
// address, locked account, wrong password - comes back as
// application.ErrInvalidCredentials, so the answer says neither which addresses are
// registered nor which accounts are locked.
//
// The order is the rule: the lockout is asked before the password is checked,
// so a locked account has nothing checked against it, and the lockout is told
// how the check went only for a password that was actually checked. An
// unknown address reaches the lockout not at all - there is no account to
// count against, and counting by address would let anybody lock anybody.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	address, err := email.New(in.Email)
	if err != nil {
		return dto.Output{}, userapplication.ErrInvalidCredentials
	}
	u, err := uc.repo.ByEmail(ctx, address.String())
	if errors.Is(err, user.ErrNotFound) {
		return dto.Output{}, userapplication.ErrInvalidCredentials
	}
	if err != nil {
		return dto.Output{}, err
	}

	allowed, err := uc.lockout.Allowed(ctx, u.ID)
	if err != nil {
		return dto.Output{}, err
	}
	if !allowed {
		return dto.Output{}, userapplication.ErrInvalidCredentials
	}

	if !uc.verifier.Verify(in.Password, u.Password) {
		if recordErr := uc.lockout.Failed(ctx, u.ID); recordErr != nil {
			// A failure that could not be counted is reported as what it is.
			// Answering with the refusal instead would let a lockout store
			// that is down turn back into unlimited guessing, silently.
			return dto.Output{}, recordErr
		}
		return dto.Output{}, userapplication.ErrInvalidCredentials
	}

	if err := uc.lockout.Succeeded(ctx, u.ID); err != nil {
		return dto.Output{}, err
	}
	return dto.Output{UserID: u.ID}, nil
}
