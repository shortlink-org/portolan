// Package extractdebezium reads Debezium Kafka Connect declarations into the
// data pipeline, source-store relationship, Kafka channels and flows they
// declare.
//
// It deliberately reads configuration, not a running Kafka Connect cluster.
// Runtime status and lag are observations for a verifier; a checked-in JSON or
// Strimzi manifest is the reproducible architecture claim an extractor owns.
package extractdebezium

import (
	"fmt"
	"io"
	"path/filepath"

	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	Context    string                      `json:"context,omitempty"`
	Paths      []string                    `json:"paths,omitempty"`
	Broker     string                      `json:"broker,omitempty"`
	Connectors map[string]ConnectorOptions `json:"connectors,omitempty"`
	Out        string                      `json:"out,omitempty"`
}

// ConnectorOptions are the estate facts Kafka Connect cannot carry. Store is
// the catalog store the connector reads. SourceService is the logical event
// publisher for an outbox: Debezium transports that service's event but does
// not become a second publisher of it.
type ConnectorOptions struct {
	Store         string  `json:"store,omitempty"`
	SourceService string  `json:"sourceService,omitempty"`
	Routes        []Route `json:"routes,omitempty"`
}

// Route supplies the values that live in outbox rows and therefore cannot be
// learned from connector configuration. Topic may be omitted when the
// configured replacement can be evaluated from Value.
type Route struct {
	Value   string `json:"value"`
	Message string `json:"message"`
	Topic   string `json:"topic,omitempty"`
}

func Serve(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: an extractor has nothing to read")
		}
		if opts.Context == "" {
			opts.Context = goscan.Slug(filepath.Base(req.Input.Root))
		}
		if opts.Context == "" {
			opts.Context = "data-platform"
		}
		if opts.Broker == "" {
			opts.Broker = "kafka"
		}
		if opts.Out == "" {
			opts.Out = "debezium.json"
		}

		return extract(req.Input, opts)
	})
}
