// Package lockout adapts the lockout module to the contract declared by the
// user authentication slice.
package lockout

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/check"
	checkdto "github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/check/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_failure"
	failuredto "github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_failure/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_success"
	successdto "github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_success/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/check_credentials"
)

// Adapter adapts the lockout module's three use cases to the shape
// check_credentials asks for.
//
// Like Authenticator, this is a place that knows two domains exist, and it is
// deliberately in infrastructure. The user domain remains independent;
// check_credentials states its need as an interface and gets handed this adapter by
// the user module's DI set.
func New(
	check *check.UseCase,
	failed *record_failure.UseCase,
	succeeded *record_success.UseCase,
) check_credentials.Lockout {
	return lockoutAdapter{check: check, failed: failed, succeeded: succeeded}
}

type lockoutAdapter struct {
	check     *check.UseCase
	failed    *record_failure.UseCase
	succeeded *record_success.UseCase
}

func (l lockoutAdapter) Allowed(ctx context.Context, userID string) (bool, error) {
	out, err := l.check.Handle(ctx, checkdto.Input{UserID: userID})
	if err != nil {
		return false, err
	}
	return out.Allowed, nil
}

func (l lockoutAdapter) Failed(ctx context.Context, userID string) error {
	return l.failed.Handle(ctx, failuredto.Input{UserID: userID})
}

func (l lockoutAdapter) Succeeded(ctx context.Context, userID string) error {
	return l.succeeded.Handle(ctx, successdto.Input{UserID: userID})
}
