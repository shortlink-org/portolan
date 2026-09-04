// Command verify-otel reads OpenTelemetry traces and says which hops of the
// catalog have been seen running.
//
// It is a verifier, not an extractor: it runs after the merge, is handed the
// catalog, and answers with a fragment that mostly re-declares what is already
// there - the same flows, with `verified` on the steps a trace shows - plus the
// consumers and calls the traces prove. A sequence no flow describes is written
// down as observed, so that a reader learns it exists.
//
// What a trace can and cannot say is kept strict. A span is a message going one
// way; it says the hop happened. It does not say a repository method was called,
// so `call` steps stay declared; and it does not put a service in the catalog,
// so a call whose far end is not there stays unresolved however often it ran.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	// Traces are the recordings to read, as globs relative to the input root.
	// OTLP JSON, one batch per file or one per line.
	Traces []string `json:"traces"`

	// Services maps a resource's service.name to a catalog service id, for an
	// estate where the two differ. Without a line here a name is matched to
	// the one service whose slug it is.
	Services map[string]string `json:"services,omitempty"`

	// Events maps an event's wire name - the `event.name` attribute,
	// "auth.PasswordChanged" - to a catalog event id, for an estate where the
	// event does not declare its wire name and the last segment of the wire
	// name is not the event's name in the model.
	Events map[string]string `json:"events,omitempty"`

	// Out names the fragment file.
	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-verify-otel:", err)
		os.Exit(1)
	}
}

func run(in io.Reader, out io.Writer) error {
	return plugin.Serve(in, out, descriptor(), verify)
}
