package session

import "errors"

var (
	// Repository and lifecycle errors are stable sentinels: adapters wrap them
	// with context and transports classify them with errors.Is.
	ErrNotFound = errors.New("session: not found")
	ErrExpired  = errors.New("session: expired")
	ErrRevoked  = errors.New("session: revoked")

	// ErrConflict means the session changed after it was read. The operation may
	// be retried only after reloading the aggregate.
	ErrConflict = errors.New("session: changed by somebody else")
)
