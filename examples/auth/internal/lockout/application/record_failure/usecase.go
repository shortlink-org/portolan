// Package record_failure counts a wrong password against an account, and locks
// the account when the count reaches the threshold.
package record_failure

import (
	"context"
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/domain/event"
)

// retries is how many times a conflicting write is redone before giving up.
// Two wrong passwords arriving together is the ordinary case here, not an
// edge: the loser reads again and counts on top of the winner.
const retries = 3

type UseCase struct {
	repo lockout.Repository
	now  func() time.Time
}

func New(repo lockout.Repository, now func() time.Time) *UseCase {
	return &UseCase{repo: repo, now: now}
}

// Handle records one wrong password. The first one for a user creates the
// lockout; the one that reaches the threshold locks it and records
// AccountLocked in the same transaction.
//
// A failure against an account that is already locked is passed over: the
// password was refused unchecked, so there is nothing to count.
func (uc *UseCase) Handle(ctx context.Context, in Command) error {
	for range retries {
		l, err := uc.repo.ByUserID(ctx, in.UserID)
		if errors.Is(err, lockout.ErrNotFound) {
			l = lockout.New(in.UserID)
		} else if err != nil {
			return err
		}

		now := uc.now()
		if !l.Allows(now) {
			return nil
		}

		var events []event.Event
		if ev, locked := l.Fail(now); locked {
			events = append(events, ev)
		}

		switch err := uc.repo.Save(ctx, l, events...); {
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
