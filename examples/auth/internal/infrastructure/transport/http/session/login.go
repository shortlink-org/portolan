package session

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/gen"
)

// Login implements POST /v1/sessions.
func (h *Sessions) Login(
	ctx context.Context,
	request gen.LoginRequestObject,
) (gen.LoginResponseObject, error) {
	out, err := h.login.Handle(ctx, dto.Input{
		Email:    request.Body.Email,
		Password: request.Body.Password,
	})
	if err != nil {
		code, message := status(err)
		if code == 401 {
			return gen.Login401JSONResponse{Message: message}, nil
		}
		return gen.Login500JSONResponse{Message: message}, nil
	}

	return gen.Login201JSONResponse{
		Token:     out.Token,
		ExpiresAt: out.ExpiresAt,
	}, nil
}
