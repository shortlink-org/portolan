// Package user implements the user half of the generated server interface.
//
// One file per operation. The type below is the whole dependency surface of
// that half: a reader can tell from it that these handlers can register and
// read a user, and that they cannot touch a session.
package user

import (
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/validate"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/change_password"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/get"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/register"
)

// Users carries the use cases the user endpoints run. It is embedded into the
// transport's Server, which is how methods spread across two packages end up
// satisfying one generated interface.
type Users struct {
	register *register.UseCase
	get      *get.UseCase

	// changePassword is the one operation here that needs to know who is
	// calling, so validate comes with it: this handler resolves the bearer
	// token itself instead of trusting a middleware to have done it.
	changePassword *change_password.UseCase
	validate       *validate.UseCase
}

func NewUsers(
	registerUC *register.UseCase,
	getUC *get.UseCase,
	changePasswordUC *change_password.UseCase,
	validateUC *validate.UseCase,
) *Users {
	return &Users{
		register:       registerUC,
		get:            getUC,
		changePassword: changePasswordUC,
		validate:       validateUC,
	}
}
