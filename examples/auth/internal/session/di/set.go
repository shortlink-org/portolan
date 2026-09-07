// Package di owns the session module's assembly.
package di

import "github.com/google/wire"

// Set assembles the session module without choosing an inbound transport or
// activating its event subscriptions.
var Set = wire.NewSet(ApplicationSet, InfrastructureSet)
