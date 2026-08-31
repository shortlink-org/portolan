//go:build wireinject

// Package di assembles the service.
//
// This file is the declaration: it names the provider sets and the thing to
// build, and its body is a stub the generator replaces. wire_gen.go, next to
// it, is what actually compiles - and it is checked in, so a clean clone builds
// without the generator installed.
package di

import (
	"net/http"

	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/di/provider"
)

//go:generate go run github.com/google/wire/cmd/wire@v0.7.0 ./...

// New assembles the whole service and returns the HTTP handler at the top of
// it.
//
// Everything below the handler - repositories, buses, use cases, the adapter
// between the two domains - is reachable only through the graph wire builds
// from these sets. A missing provider is a generation-time error rather than a
// nil dereference on the first request.
func New() http.Handler {
	wire.Build(
		provider.Ambient,
		provider.Repository,
		provider.Bus,
		provider.UseCase,
		provider.Authenticator,
		provider.Transport,
	)
	return nil
}
