package di

import (
	"context"
	"net/http"

	"github.com/shortlink-org/go-sdk/db/drivers/postgres"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"
)

// App is the assembled service.
//
// Handler is what serves. Driver is here so that whoever built the App can
// close it: assembly opened the connection, so assembly has to hand back the
// means to let it go.
//
// Relay is the second thing this service runs. It reads events out of the
// outbox and gives them to the policies, which is why it is a field rather than
// something started somewhere out of sight: a service that quietly has a second
// process is a service nobody remembers to shut down.
type App struct {
	Handler http.Handler
	Driver  *postgres.Store
	Relay   *sdkoutbox.Relay
}

// Run reads the outbox until the context is cancelled. It blocks, and it is the
// only part of the App that does.
//
// It runs the router too: the relay's handlers and anything else on that router
// share one Run, and the reaper that clears delivered rows lives inside it.
func (a App) Run(ctx context.Context) error {
	if a.Relay == nil {
		return nil
	}
	return a.Relay.Run(ctx)
}

// Close releases what assembly opened.
//
// It is the driver rather than db.Store because closing lives on the driver:
// db.Store embeds the DB interface, which has no Close of its own.
func (a App) Close() {
	if a.Relay != nil {
		_ = a.Relay.Close()
	}
	if a.Driver != nil {
		a.Driver.Close()
	}
}
