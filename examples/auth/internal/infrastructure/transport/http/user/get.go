package user

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/get/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/gen"
)

// GetUser implements GET /v1/users/{userId}.
func (h *Users) GetUser(
	ctx context.Context,
	request gen.GetUserRequestObject,
) (gen.GetUserResponseObject, error) {
	out, err := h.get.Handle(ctx, dto.Input{UserID: request.UserId})
	if err != nil {
		code, message := status(err)
		if code == 404 {
			return gen.GetUser404JSONResponse{Message: message}, nil
		}
		return gen.GetUser500JSONResponse{Message: message}, nil
	}

	return gen.GetUser200JSONResponse{
		UserId:    out.UserID,
		Email:     out.Email,
		CreatedAt: out.CreatedAt,
	}, nil
}
