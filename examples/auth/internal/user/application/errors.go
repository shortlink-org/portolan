// Package application exposes errors shared by the user module's use cases.
package application

import "errors"

// ErrInvalidCredentials deliberately collapses every failed credential check
// into one result. Transport must not reveal whether the user or password was
// the part that failed.
var ErrInvalidCredentials = errors.New("user: invalid credentials")
