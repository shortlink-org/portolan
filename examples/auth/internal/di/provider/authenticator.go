package provider

import (
	"context"

	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/authenticate"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/authenticate/dto"
)

// Authenticator adapts the user domain's credential check to the shape login
// asks for.
//
// This is the single place in the tree that knows both domains exist, and it is
// deliberately in assembly. The session packages never import the user ones;
// login states its need as an interface and gets handed this.
var Authenticator = wire.NewSet(
	ProvideAuthenticator,
)

func ProvideAuthenticator(uc *authenticate.UseCase) login.Authenticator {
	return authenticator{uc: uc}
}

type authenticator struct {
	uc *authenticate.UseCase
}

// Authenticate passes the failure through untouched. Translating it here would
// be the one way to accidentally make a wrong password distinguishable from an
// unknown address.
func (a authenticator) Authenticate(ctx context.Context, email, password string) (string, error) {
	out, err := a.uc.Handle(ctx, dto.Input{Email: email, Password: password})
	if err != nil {
		return "", err
	}
	return out.UserID, nil
}
