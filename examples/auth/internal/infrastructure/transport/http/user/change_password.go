package user

import (
	"context"
	"errors"
	"strings"

	validatedto "github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/validate/dto"
	changedto "github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/change_password/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/gen"
)

// ChangePassword implements POST /v1/users/me/password.
//
// It is the only endpoint here that has to know who is calling, so it resolves
// the bearer token itself through the validate use case rather than through
// middleware. There is no hidden step: the dependency is in the constructor,
// and a reader can see that this handler authenticates and the others do not.
func (h *Users) ChangePassword(
	ctx context.Context,
	request gen.ChangePasswordRequestObject,
) (gen.ChangePasswordResponseObject, error) {
	current, err := h.validate.Handle(ctx, validatedto.Input{Token: bearer(request.Params.Authorization)})
	if err != nil {
		// Every reason a token can fail is one answer, exactly as it is on the
		// endpoints the session package serves.
		return gen.ChangePassword401JSONResponse{Message: "unauthorized"}, nil
	}

	err = h.changePassword.Handle(ctx, changedto.Input{
		UserID: current.UserID,
		// The session this was made from is spared, so the person is not signed
		// out of the device they are holding.
		By:      current.SessionID,
		Current: request.Body.CurrentPassword,
		New:     request.Body.NewPassword,
	})
	if err != nil {
		return changePasswordFailure(err), nil
	}

	return gen.ChangePassword204Response{}, nil
}

func changePasswordFailure(err error) gen.ChangePasswordResponseObject {
	code, message := status(err)
	switch code {
	case 400:
		broken := reasons(err)
		return gen.ChangePassword400JSONResponse{Message: message, Reasons: &broken}
	case 401:
		// A wrong current password. The same answer a failed login gets, so
		// this endpoint cannot be used to test passwords more cheaply than the
		// front door.
		return gen.ChangePassword401JSONResponse{Message: message}
	case 409:
		return gen.ChangePassword409JSONResponse{Message: message}
	default:
		if errors.Is(err, session.ErrConflict) {
			return gen.ChangePassword409JSONResponse{Message: "please retry"}
		}
		return gen.ChangePassword500JSONResponse{Message: message}
	}
}

// bearer pulls the token out of an Authorization header. A header that is not a
// bearer yields the empty string, which every caller treats as an unknown
// token - the answer a malformed header deserves.
func bearer(header gen.BearerToken) string {
	const prefix = "Bearer "
	value := string(header)
	if len(value) < len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(value[len(prefix):])
}
