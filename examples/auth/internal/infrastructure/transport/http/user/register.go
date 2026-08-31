package user

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/register/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/gen"
)

// RegisterUser implements POST /v1/users.
//
// It translates in both directions and decides nothing: the wire shape becomes
// dto.Input, the use case answers, and dto.Output becomes the wire shape. The
// two are separate types so that renaming a JSON field never reaches into the
// application layer.
func (h *Users) RegisterUser(
	ctx context.Context,
	request gen.RegisterUserRequestObject,
) (gen.RegisterUserResponseObject, error) {
	out, err := h.register.Handle(ctx, dto.Input{
		Email:    request.Body.Email,
		Password: request.Body.Password,
	})
	if err != nil {
		code, message := status(err)
		switch code {
		case 409:
			return gen.RegisterUser409JSONResponse{Message: message}, nil
		case 400:
			// Every rule the value broke, not just the first, so a form can
			// mark all of them at once.
			broken := reasons(err)
			return gen.RegisterUser400JSONResponse{Message: message, Reasons: &broken}, nil
		default:
			return gen.RegisterUser500JSONResponse{Message: message}, nil
		}
	}

	return gen.RegisterUser201JSONResponse{
		UserId:    out.UserID,
		Email:     out.Email,
		CreatedAt: out.CreatedAt,
	}, nil
}
