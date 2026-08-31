// Package http wires the generated server interface to the handlers that
// implement it.
//
// gen/openapi.yaml is the source: it defines the routes, the shapes and the
// status codes, and gen/server.gen.go is its output. Nothing in this package
// decides a route or a shape - it only assembles.
//
// The go:generate directive lives in gen/, not here: it runs with the working
// directory of the file that holds it, and from here it would write its output
// beside this file instead of into gen/.
package http

import (
	nethttp "net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/gen"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/user"
)

// Server is the whole implementation of gen.StrictServerInterface, assembled
// from two packages by embedding.
//
// The generator insists on one type carrying every operation; embedding is what
// lets the handlers still live next to the domain they serve. The two embedded
// types must not share a name - Go takes the field name from the type - which
// is why they are Users and Sessions rather than Handler twice. Operation ids
// must not collide either, or a method would be promoted ambiguously and the
// interface would quietly stop being satisfied.
type Server struct {
	*user.Users
	*session.Sessions
}

var _ gen.StrictServerInterface = (*Server)(nil)

func NewServer(users *user.Users, sessions *session.Sessions) *Server {
	return &Server{Users: users, Sessions: sessions}
}

// Router returns the routes described by the spec, mounted on a fresh chi
// router.
func Router(srv *Server) nethttp.Handler {
	return gen.HandlerFromMux(gen.NewStrictHandler(srv, nil), chi.NewRouter())
}
