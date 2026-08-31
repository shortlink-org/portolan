package session

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/validate/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/gen"
)

// ValidateSession implements GET /v1/sessions/current. This is the hot path:
// it reads and writes nothing.
func (h *Sessions) ValidateSession(
	ctx context.Context,
	request gen.ValidateSessionRequestObject,
) (gen.ValidateSessionResponseObject, error) {
	out, err := h.validate.Handle(ctx, dto.Input{Token: bearer(request.Params.Authorization)})
	if err != nil {
		code, message := status(err)
		if code == 401 {
			return gen.ValidateSession401JSONResponse{Message: message}, nil
		}
		return gen.ValidateSession500JSONResponse{Message: message}, nil
	}

	return gen.ValidateSession200JSONResponse{
		UserId:    out.UserID,
		ExpiresAt: out.ExpiresAt,
	}, nil
}
