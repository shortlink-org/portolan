// Package provider holds the wire provider sets, one file per layer. Together
// they describe how the service is assembled; nothing here decides behaviour.
package provider

import (
	"time"

	"github.com/google/uuid"
	"github.com/google/wire"
)

// Ambient is what every layer needs and nothing owns: the current time, and a
// source of ids.
//
// Both are passed as plain functions rather than named types. A named Clock
// would have to live in a package the application layer may import, and there
// is no honest home for one - the alternative is inventing a shared package to
// prevent a collision that does not exist yet. Wire tells func() time.Time and
// func() string apart, so today there is nothing to prevent.
var Ambient = wire.NewSet(
	ProvideNow,
	ProvideNewID,
)

// ProvideNow hands out UTC. Local time in a domain is a bug waiting for a
// deployment in another timezone.
func ProvideNow() func() time.Time {
	return func() time.Time { return time.Now().UTC() }
}

func ProvideNewID() func() string {
	return uuid.NewString
}
