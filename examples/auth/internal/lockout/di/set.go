// Package di owns the lockout module's assembly.
package di

import "github.com/google/wire"

// Set assembles the lockout module.
var Set = wire.NewSet(ApplicationSet, InfrastructureSet)
