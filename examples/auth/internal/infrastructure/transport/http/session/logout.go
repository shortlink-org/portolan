package session

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/logout/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/gen"
)

// Logout implements DELETE /v1/sessions/current.
//
// There is no 401 arm. A token that is unknown, malformed or already revoked
// still gets 204: the caller asked for there to be no session, and afterwards
// there is none. Only a genuine failure on our side is worth reporting.
func (h *Sessions) Logout(
	ctx context.Context,
	request gen.LogoutRequestObject,
) (gen.LogoutResponseObject, error) {
	if err := h.logout.Handle(ctx, dto.Input{Token: bearer(request.Params.Authorization)}); err != nil {
		_, message := status(err)
		return gen.Logout500JSONResponse{Message: message}, nil
	}
	return gen.Logout204Response{}, nil
}
