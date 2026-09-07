// Package register holds the registration use case: create a user, store it,
// and announce it.
package register

import (
	"context"
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/register/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/email"
)

// UseCase names exactly the ports registration needs. A reader can tell from
// this struct what the use case is able to touch - and that it cannot, for
// instance, read a session.
type UseCase struct {
	repo   user.Repository
	hasher PasswordHasher
	now    func() time.Time
	newID  func() string
}

func New(repo user.Repository, hasher PasswordHasher, now func() time.Time, newID func() string) *UseCase {
	return &UseCase{repo: repo, hasher: hasher, now: now, newID: newID}
}

// Handle registers a user. A second registration of the same address is refused
// with user.ErrEmailTaken rather than quietly returning the first one: the
// caller asked to create something, and it did not happen.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	address, err := email.New(in.Email)
	if err != nil {
		return dto.Output{}, err
	}
	if _, err := uc.repo.ByEmail(ctx, address.String()); err == nil {
		return dto.Output{}, user.ErrEmailTaken
	} else if !errors.Is(err, user.ErrNotFound) {
		return dto.Output{}, err
	}

	hash, err := uc.hasher.Hash(in.Password)
	if err != nil {
		return dto.Output{}, err
	}
	u, ev, err := user.Register(uc.newID(), in.Email, hash, uc.now())
	if err != nil {
		return dto.Output{}, err
	}
	// The event goes in with the write. Announcing a user that failed to save
	// would be a lie no consumer could detect, so the two are one call and the
	// repository is left to make them one act.
	if err := uc.repo.Save(ctx, u, ev); err != nil {
		return dto.Output{}, err
	}

	return dto.Output{
		UserID:    u.ID,
		Email:     u.Email.String(),
		CreatedAt: u.CreatedAt,
	}, nil
}
