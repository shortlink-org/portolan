// Package login turns credentials into a session.
package login

import (
	"context"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
)

// Authenticator is what login needs in order to not check the password itself:
// somebody who can turn credentials into a user id.
//
// It is declared HERE, by the only code that calls it, rather than in the
// session domain - no line of the domain uses it, and Start already takes a
// plain user id. The implementation is the user domain's authenticate use case,
// adapted to this shape at wiring time; that keeps the knowledge that both
// domains exist in one place, the assembly.
type Authenticator interface {
	// Authenticate returns the id of the user, or an error if the credentials
	// are not good. It must not distinguish an unknown address from a wrong
	// password.
	Authenticate(ctx context.Context, email, password string) (userID string, err error)
}

// UseCase holds exactly the ports login needs, and no others.
type UseCase struct {
	repo  session.Repository
	auth  Authenticator
	bus   session.Publisher
	now   func() time.Time
	newID func() string
}

func New(
	repo session.Repository,
	auth Authenticator,
	bus session.Publisher,
	now func() time.Time,
	newID func() string,
) *UseCase {
	return &UseCase{repo: repo, auth: auth, bus: bus, now: now, newID: newID}
}

// Handle authenticates, then starts a session. The order is the rule: a session
// is never issued for a user the user domain did not vouch for, and the failure
// from the Authenticator is passed through untouched so it keeps saying nothing
// about which half of the credentials was wrong.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	userID, err := uc.auth.Authenticate(ctx, in.Email, in.Password)
	if err != nil {
		return dto.Output{}, err
	}

	sess, ev, err := session.Start(uc.newID(), userID, uc.now())
	if err != nil {
		return dto.Output{}, err
	}
	if err := uc.repo.Save(ctx, sess); err != nil {
		return dto.Output{}, err
	}
	if err := uc.bus.Publish(ctx, []event.Event{ev}); err != nil {
		return dto.Output{}, err
	}

	return dto.Output{
		Token:     sess.Token.String(),
		ExpiresAt: sess.ExpiresAt,
	}, nil
}
