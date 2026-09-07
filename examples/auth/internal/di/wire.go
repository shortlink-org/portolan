//go:build wireinject

// Package di assembles the service.
//
// This file is the declaration: it names the provider sets and the thing to
// build, and its body is a stub the generator replaces. wire_gen.go, next to
// it, is what actually compiles - and it is checked in, so a clean clone builds
// without the generator installed.
package di

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/di/provider"
	lockoutdi "github.com/shortlink-org/portolan/examples/auth/internal/lockout/di"
	sessiondi "github.com/shortlink-org/portolan/examples/auth/internal/session/di"
	userdi "github.com/shortlink-org/portolan/examples/auth/internal/user/di"
)

// New assembles the whole service.
//
// Everything below the handler - the database, repositories, buses, use cases,
// policies, the adapter between the two domains - is reachable only through the
// graph wire builds from these sets. A missing provider is a generation-time
// error rather than a nil dereference on the first request.
func New() (App, error) {
	wire.Build(
		provider.Settings,
		provider.Storage,
		provider.Cache,
		provider.Ambient,
		provider.Outbox,
		lockoutdi.Set,
		userdi.Set,
		sessiondi.Set,
		sessiondi.PolicySet,
		provider.Bus,
		userdi.HTTPSet,
		sessiondi.HTTPSet,
		provider.Transport,
		wire.Struct(new(App), "*"),
	)
	return App{}, nil
}
