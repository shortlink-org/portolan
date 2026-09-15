// Package login_passkey turns a passkey assertion into a session.
package login_passkey

import (
	"context"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
)

// UseCase holds exactly the ports a passkey login needs, and no others. Risk
// is login's port: a passkey is another way to prove who you are, not another
// way to be judged.
type UseCase struct {
	repo     session.Repository
	verifier Verifier
	risk     login.Risk
	now      func() time.Time
	newID    func() string
}

func New(
	repo session.Repository,
	verifier Verifier,
	risk login.Risk,
	now func() time.Time,
	newID func() string,
) *UseCase {
	return &UseCase{repo: repo, verifier: verifier, risk: risk, now: now, newID: newID}
}

// Handle verifies the assertion, asks risk, then starts a session marked as a
// passkey login. The order is the password login's: nothing is issued for an
// assertion the verifier did not accept or an attempt risk judged hostile.
func (uc *UseCase) Handle(ctx context.Context, in Command) (Result, error) {
	userID, err := uc.verifier.Verify(ctx, Assertion(in))
	if err != nil {
		return Result{}, err
	}

	verdict, err := uc.risk.Assess(ctx, login.Attempt{UserID: userID})
	if err != nil {
		return Result{}, err
	}
	if verdict == login.VerdictBlock {
		return Result{}, login.ErrBlocked
	}

	sess, ev, err := session.StartWith(uc.newID(), userID, event.MethodPasskey, uc.now())
	if err != nil {
		return Result{}, err
	}
	if err := uc.repo.Save(ctx, sess, ev); err != nil {
		return Result{}, err
	}

	return Result{Token: sess.Token.String(), ExpiresAt: sess.ExpiresAt}, nil
}
