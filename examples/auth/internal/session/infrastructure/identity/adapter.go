// Package identity adapts the user module to the credential contract declared
// by the session login slice.
package identity

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/check_credentials"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/check_credentials/dto"
)

// Authenticator adapts the user module's credential check to the shape login
// asks for. The adapter belongs to the consuming session module; neither
// application package imports the other module.
//
// This is an explicit cross-module seam and is deliberately in infrastructure.
// Login states its need as an interface and gets handed this adapter by the
// session module's DI set.
func NewAuthenticator(uc *check_credentials.UseCase) login.Authenticator {
	return authenticator{uc: uc}
}

type authenticator struct {
	uc *check_credentials.UseCase
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
