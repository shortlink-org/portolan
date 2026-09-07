// Package change_password replaces a user's password.
//
// It does not touch sessions. That a password change ends the sessions issued
// against the old one is a rule about sessions, and it is applied by a policy
// listening for the event this use case publishes - so an administrative reset
// or an import gets the same treatment without remembering to ask for it.
package change_password

import (
	"context"
	"time"

	userapplication "github.com/shortlink-org/portolan/examples/auth/internal/user/application"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/change_password/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
)

type UseCase struct {
	repo   user.Repository
	hasher PasswordHasher
	now    func() time.Time
}

func New(repo user.Repository, hasher PasswordHasher, now func() time.Time) *UseCase {
	return &UseCase{repo: repo, hasher: hasher, now: now}
}

// Handle changes the password. A wrong current password comes back as
// application.ErrInvalidCredentials, the same answer a failed login gets: this is a
// credential check, and it must not become a way to test passwords that reports
// differently from the front door.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	u, err := uc.repo.ByID(ctx, in.UserID)
	if err != nil {
		return err
	}

	if !uc.hasher.Verify(in.Current, u.Password) {
		return userapplication.ErrInvalidCredentials
	}
	hash, err := uc.hasher.Hash(in.New)
	if err != nil {
		return err
	}
	ev, err := u.ChangePassword(hash, in.By, uc.now())
	if err != nil {
		return err
	}
	return uc.repo.Save(ctx, u, ev)
}
