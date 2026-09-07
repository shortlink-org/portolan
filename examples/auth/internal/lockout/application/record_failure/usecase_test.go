package record_failure_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_failure"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_failure/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/domain/event"
)

func TestConflictReloadsAndCountsOnTopOfTheWinner(t *testing.T) {
	repository := NewMockRepository(t)
	var stored *lockout.Lockout
	saves := 0

	repository.EXPECT().ByUserID(mock.Anything, "u1").
		RunAndReturn(func(context.Context, string) (*lockout.Lockout, error) {
			if stored == nil {
				return nil, lockout.ErrNotFound
			}
			return stored.Clone(), nil
		}).Twice()
	repository.EXPECT().Save(mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, candidate *lockout.Lockout, _ ...event.Event) error {
			saves++
			if saves == 1 {
				stored = lockout.New(candidate.UserID)
				stored.Fail(time.Unix(0, 0))
				stored.Version = 1
				return lockout.ErrConflict
			}
			stored = candidate.Clone()
			stored.Version++
			return nil
		}).Twice()

	uc := record_failure.New(repository, func() time.Time { return time.Unix(0, 0) })
	if err := uc.Handle(context.Background(), dto.Input{UserID: "u1"}); err != nil {
		t.Fatal(err)
	}
	if saves != 2 || stored.Failures != 2 || stored.Version != 2 {
		t.Fatalf("saves = %d, stored = %+v", saves, stored)
	}
}

func TestExhaustedRetriesReturnAClassifiableConflict(t *testing.T) {
	repository := NewMockRepository(t)
	repository.EXPECT().ByUserID(mock.Anything, "u1").
		RunAndReturn(func(context.Context, string) (*lockout.Lockout, error) {
			current := lockout.New("u1")
			current.Version = 1
			return current, nil
		}).Times(3)
	repository.EXPECT().Save(mock.Anything, mock.Anything).Return(lockout.ErrConflict).Times(3)

	err := record_failure.New(repository, time.Now).Handle(context.Background(), dto.Input{UserID: "u1"})
	if !errors.Is(err, lockout.ErrConflict) {
		t.Fatalf("= %v, want ErrConflict", err)
	}
}
