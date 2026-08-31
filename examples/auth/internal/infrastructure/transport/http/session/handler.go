// Package session implements the session half of the generated server
// interface. One file per operation.
package session

import (
	"strings"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/logout"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/validate"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/gen"
)

// Sessions carries the use cases the session endpoints run. It is embedded into
// the transport's Server alongside the user handler.
type Sessions struct {
	login    *login.UseCase
	logout   *logout.UseCase
	validate *validate.UseCase
}

func NewSessions(loginUC *login.UseCase, logoutUC *logout.UseCase, validateUC *validate.UseCase) *Sessions {
	return &Sessions{login: loginUC, logout: logoutUC, validate: validateUC}
}

// bearer pulls the token out of an Authorization header.
//
// A header that is not a bearer yields the empty string rather than an error.
// Every caller here treats an empty token the same as an unknown one, which is
// the answer a malformed header deserves: it says nothing about what a valid
// token looks like.
func bearer(header gen.BearerToken) string {
	const prefix = "Bearer "
	value := string(header)
	if len(value) < len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(value[len(prefix):])
}
