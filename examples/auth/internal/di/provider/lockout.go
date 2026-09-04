package provider

import (
	"context"

	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/lockout/usecases/check"
	checkdto "github.com/shortlink-org/portolan/examples/auth/internal/application/lockout/usecases/check/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/lockout/usecases/record_failure"
	failuredto "github.com/shortlink-org/portolan/examples/auth/internal/application/lockout/usecases/record_failure/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/lockout/usecases/record_success"
	successdto "github.com/shortlink-org/portolan/examples/auth/internal/application/lockout/usecases/record_success/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/authenticate"
)

// Lockout adapts the lockout domain's three use cases to the shape
// authenticate asks for.
//
// Like Authenticator, this is a place that knows two domains exist, and it is
// deliberately in assembly. The user packages never import the lockout ones;
// authenticate states its need as an interface and gets handed this.
var Lockout = wire.NewSet(
	ProvideLockout,
)

func ProvideLockout(
	check *check.UseCase,
	failed *record_failure.UseCase,
	succeeded *record_success.UseCase,
) authenticate.Lockout {
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
