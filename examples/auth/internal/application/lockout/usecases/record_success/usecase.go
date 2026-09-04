// Package record_success clears the count of wrong passwords after a right one.
package record_success

import (
	"context"
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/lockout/usecases/record_success/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout"
)

// retries is how many times a conflicting write is redone. A success racing a
// wrong password from somewhere else is rare but not impossible; the right
// answer is to look again, not to leave a stale count.
const retries = 3

type UseCase struct {
	repo lockout.Repository
	now  func() time.Time
}

func New(repo lockout.Repository, now func() time.Time) *UseCase {
	return &UseCase{repo: repo, now: now}
}

// Handle clears the count. For the common user, who has never typed a wrong
// password, there is no lockout to clear and nothing is written; for one with
// a count, it goes back to zero.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	for range retries {
		l, err := uc.repo.ByUserID(ctx, in.UserID)
		if errors.Is(err, lockout.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}

		if !l.Succeed(uc.now()) {
			return nil
		}

		switch err := uc.repo.Save(ctx, l); {
		case err == nil:
			return nil
		case errors.Is(err, lockout.ErrConflict):
			continue
		default:
			return err
		}
	}

	return lockout.ErrConflict
}
