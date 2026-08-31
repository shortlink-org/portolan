// Package user implements the user half of the generated server interface.
//
// One file per operation. The type below is the whole dependency surface of
// that half: a reader can tell from it that these handlers can register and
// read a user, and that they cannot touch a session.
package user

import (
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/get"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/register"
)

// Users carries the use cases the user endpoints run. It is embedded into the
// transport's Server, which is how methods spread across two packages end up
// satisfying one generated interface.
type Users struct {
	register *register.UseCase
	get      *get.UseCase
}

func NewUsers(registerUC *register.UseCase, getUC *get.UseCase) *Users {
	return &Users{register: registerUC, get: getUC}
}
