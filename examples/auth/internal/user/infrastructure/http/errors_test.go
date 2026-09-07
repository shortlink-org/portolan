package user

import (
	"errors"
	"testing"

	userapplication "github.com/shortlink-org/portolan/examples/auth/internal/user/application"
	userdomain "github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
)

func TestStatusClassifiesOwnedErrors(t *testing.T) {
	tests := []struct {
		name    string
		err     error
		code    int
		message string
	}{
		{"email validation", email.ErrInvalid, 400, "the request is not acceptable"},
		{"password validation", password.ErrInvalid, 400, "the request is not acceptable"},
		{"email taken", userdomain.ErrEmailTaken, 409, "that address is already registered"},
		{"conflict", userdomain.ErrConflict, 409, "the user was changed by somebody else; read it again and retry"},
		{"credentials", userapplication.ErrInvalidCredentials, 401, "invalid credentials"},
		{"not found", userdomain.ErrNotFound, 404, "no such user"},
		{"unknown", errors.New("database detail"), 500, "internal error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, message := status(tt.err)
			if code != tt.code || message != tt.message {
				t.Fatalf("status = (%d, %q), want (%d, %q)", code, message, tt.code, tt.message)
			}
		})
	}
}
