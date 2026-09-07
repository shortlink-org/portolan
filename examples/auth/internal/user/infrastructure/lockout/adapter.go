// Package lockout adapts the lockout module to the contract declared by the
// user authentication slice.
package lockout

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/check"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_failure"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_success"
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
	out, err := l.check.Handle(ctx, check.Query{UserID: userID})
	if err != nil {
		return false, err
	}
	return out.Allowed, nil
}

func (l lockoutAdapter) Failed(ctx context.Context, userID string) error {
	return l.failed.Handle(ctx, record_failure.Command{UserID: userID})
}

func (l lockoutAdapter) Succeeded(ctx context.Context, userID string) error {
	return l.succeeded.Handle(ctx, record_success.Command{UserID: userID})
}
