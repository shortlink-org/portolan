package provider

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	sessionbus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/session"
	userbus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/user"
)

// Bus binds the in-process buses to the Publisher ports.
//
// Nothing subscribes to them here. Assembly wires who CAN publish; who listens
// is a decision for whoever has something to do with an event, and there is
// nobody yet.
var Bus = wire.NewSet(
	userbus.NewInProc,
	wire.Bind(new(user.Publisher), new(*userbus.InProc)),

	sessionbus.NewInProc,
	wire.Bind(new(session.Publisher), new(*sessionbus.InProc)),
)
