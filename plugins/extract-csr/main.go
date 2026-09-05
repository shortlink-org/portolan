// Package main is portolan-extract-csr: schemas vendored out of a Confluent
// Schema Registry in, a catalog fragment out.
//
// It reads what portolan-fetch-csr committed - a directory per subject, each
// holding one schema and the `csr.lock.json` that says which registration it
// is - and answers with the two facts a registry knows that nothing else in
// the estate does: which topics carry which messages, and what those messages
// are shaped like, field by field.
//
// It opens nothing. That is the point of the split: portolan-fetch-csr owns
// the socket and the credential, this owns the reading, and CI runs this over
// a tree it can verify without a registry existing at all.
//
// What it does NOT do is invent events. An Event in the catalog belongs to an
// aggregate, and a registry has no idea which aggregate raises what - it holds
// schemas, not domains. So the shapes land in `defs`, where a shared shape
// belongs, and the topics land in the service's channels, the same place an
// AsyncAPI document's do. The domain extractor says an aggregate raises
// OrderPlaced and calls it `shop.oms.OrderPlaced` on the wire; this says a
// schema by that name is registered against topic `shop.oms.order` and has
// these fields. Neither knows the other exists, and the pages hold the two
// against each other.
//
// PROTOBUF subjects are named but not shaped. Reading protobuf properly is
// portolan-extract-proto's whole job, and a second, worse parser here would
// be a second answer to one question. Point extract-proto at the vendored
// directory for those.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor: the things a registry
// does not say about the estate its schemas belong to.
type Options struct {
	Context string `json:"context,omitempty"`
	Service string `json:"service,omitempty"`

	// Paths narrows the search to the directories fetch-csr wrote into,
	// relative to the input root. Left out, the whole root is walked for
	// locks.
	Paths []string `json:"paths,omitempty"`

	// Strategy is how a subject name relates to a topic and a record. It is
	// the producer's choice of SubjectNameStrategy, and nothing in the
	// registry's answer says which one was used - the same string is a topic
	// plus a suffix under one and a record's full name under another.
	Strategy string `json:"strategy,omitempty"`

	// Direction is which way the channels this service registers schemas for
	// travel, from this service's side. A registry records no producer and no
	// consumer, so this cannot be read and has to be told; "send" is the
	// default because the service that registers a schema is usually the one
	// putting it on the bus.
	Direction string `json:"direction,omitempty"`

	// Subjects overrides Direction for named subjects, for the service that
	// both publishes and listens.
	Subjects map[string]string `json:"subjects,omitempty"`

	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-csr:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: an extractor has nothing to read")
		}

		return extract(req.Input, opts)
	})
}
