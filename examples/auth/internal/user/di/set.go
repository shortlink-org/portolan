// Package di owns the user module's assembly. The service composition root
// imports this package; user domain and application packages never import it.
package di

import "github.com/google/wire"

// Set assembles the user module without choosing an inbound transport.
var Set = wire.NewSet(ApplicationSet, InfrastructureSet)
