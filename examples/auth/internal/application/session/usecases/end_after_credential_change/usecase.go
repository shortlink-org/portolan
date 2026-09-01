// Package end_after_credential_change ends the sessions a credential change
// invalidates.
package end_after_credential_change

import (
	"context"
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/end_after_credential_change/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/services"
)

// retries is how many times one session is re-read after losing a version
// check. A handful: a session has few writers, and a conflict here means
// somebody logged out of that device at the same moment.
const retries = 3

type UseCase struct {
	repo session.Repository
	bus  session.Publisher
	now  func() time.Time
}

func New(repo session.Repository, bus session.Publisher, now func() time.Time) *UseCase {
	return &UseCase{repo: repo, bus: bus, now: now}
}

// Handle asks the domain service which sessions the change ends, and ends them.
//
// Which ones die is not decided here - that is services.CredentialChange, and
// keeping it there is what makes the rule testable without a store. This use
// case loads, applies, and writes.
//
// Each session is its own transaction. One write covering all of them would be
// a single transaction spanning several aggregates, and it would mean one
// unlucky conflict undoing every other revocation.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	sessions, err := uc.repo.ByUserID(ctx, in.UserID)
	if err != nil {
		return err
	}

	change := services.CredentialChange{At: in.ChangedAt, Keep: in.Keep}

	for _, doomed := range change.Ends(sessions, uc.now()) {
		if err := uc.end(ctx, doomed.ID); err != nil {
			return err
		}
	}
	return nil
}

// end revokes one session, re-reading it if somebody changed it in between.
//
// A conflict is not a failure: it means that session was written by somebody
// else - a logout from that very device, most likely - and the right response
// is to look at it again, not to give up on the rest.
func (uc *UseCase) end(ctx context.Context, id string) error {
	for attempt := range retries {
		current, err := uc.repo.ByID(ctx, id)
		if errors.Is(err, session.ErrNotFound) {
			// Gone while we were deciding. There is nothing left to end.
			return nil
		}
		if err != nil {
			return err
		}

		ev, ended := current.Revoke(event.ReasonPasswordChanged, uc.now())
		if !ended {
			// Somebody got there first. Their event already said so.
			return nil
		}

		switch err := uc.repo.Save(ctx, current); {
		case err == nil:
			return uc.bus.Publish(ctx, []event.Event{ev})
		case errors.Is(err, session.ErrConflict):
			_ = attempt // read it again
		default:
			return err
		}
	}
	return session.ErrConflict
}
