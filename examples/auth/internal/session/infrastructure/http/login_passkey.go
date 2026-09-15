package session

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login_passkey"
	"github.com/shortlink-org/portolan/examples/auth/internal/transport/http/gen"
)

// LoginWithPasskey implements POST /v1/sessions/passkey.
func (h *Sessions) LoginWithPasskey(
	ctx context.Context,
	request gen.LoginWithPasskeyRequestObject,
) (gen.LoginWithPasskeyResponseObject, error) {
	out, err := h.loginPasskey.Handle(ctx, login_passkey.Command{
		CredentialID: request.Body.CredentialId,
		Challenge:    request.Body.Challenge,
		Signature:    request.Body.Signature,
	})
	if err != nil {
		code, message := status(err)
		if code == 401 {
			return gen.LoginWithPasskey401JSONResponse{Message: message}, nil
		}
		return gen.LoginWithPasskey500JSONResponse{Message: message}, nil
	}

	return gen.LoginWithPasskey201JSONResponse{
		Token:     out.Token,
		ExpiresAt: out.ExpiresAt,
	}, nil
}
