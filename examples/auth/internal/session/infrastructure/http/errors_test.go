package session

import (
	"errors"
	"testing"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login"
	sessiondomain "github.com/shortlink-org/portolan/examples/auth/internal/session/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/vo/token"
	userapplication "github.com/shortlink-org/portolan/examples/auth/internal/user/application"
)

func TestCredentialAndTokenFailuresShareOnePublicAnswer(t *testing.T) {
	for _, err := range []error{
		sessiondomain.ErrNotFound,
		sessiondomain.ErrExpired,
		sessiondomain.ErrRevoked,
		token.ErrInvalid,
		userapplication.ErrInvalidCredentials,
		login.ErrBlocked,
	} {
		code, message := status(err)
		if code != 401 || message != "unauthorized" {
			t.Errorf("status(%v) = (%d, %q), want the common 401", err, code, message)
		}
	}
}

func TestStatusClassifiesConflictAndHidesUnknownErrors(t *testing.T) {
	if code, _ := status(sessiondomain.ErrConflict); code != 409 {
		t.Fatalf("conflict status = %d, want 409", code)
	}
	if code, message := status(errors.New("database detail")); code != 500 || message != "internal error" {
		t.Fatalf("unknown status = (%d, %q), want hidden 500", code, message)
	}
}
