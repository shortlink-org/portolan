package user

import "errors"

var (
	// ErrNotFound and ErrEmailTaken are storage-port outcomes expressed in the
	// language of the aggregate rather than in Postgres error codes.
	ErrNotFound   = errors.New("user: not found")
	ErrEmailTaken = errors.New("user: email already registered")

	// ErrConflict asks the caller to reload, reapply the command and retry.
	ErrConflict = errors.New("user: changed by somebody else")

	// ErrPasswordRequired protects the aggregate from being created or updated
	// with the zero password-hash value.
	ErrPasswordRequired = errors.New("user: password hash is required")
)
