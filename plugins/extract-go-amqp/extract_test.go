package extractgoamqp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func extracted(t *testing.T, root string) (map[string]catalog.Channel, []string) {
	t.Helper()
	resp, err := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "svc"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Files[0].Name != "amqp.json" {
		t.Errorf("fragment name = %q", resp.Files[0].Name)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	byAddress := map[string]catalog.Channel{}
	for _, channel := range out.Contexts[0].Services[0].Channels {
		if channel.Protocol != "amqp" {
			t.Errorf("%s: protocol %q", channel.Address, channel.Protocol)
		}
		byAddress[channel.Address] = channel
	}
	var warnings []string
	for _, warning := range resp.Warnings() {
		warnings = append(warnings, warning.Ref+": "+warning.Message)
	}
	return byAddress, warnings
}

// want holds a channel to its kind, title and source, and to each sentence
// its doc must carry.
func want(t *testing.T, got map[string]catalog.Channel, address string, kind catalog.ChannelKind, title, source string, doc ...string) {
	t.Helper()
	channel, ok := got[address]
	if !ok {
		t.Errorf("no channel %q", address)
		return
	}
	if channel.Kind != kind || channel.Title != title || channel.Source != source {
		t.Errorf("%s: kind %q, title %q, source %q; want %q, %q, %q", address, channel.Kind, channel.Title, channel.Source, kind, title, source)
	}
	for _, sentence := range doc {
		if !strings.Contains(channel.Doc, sentence) {
			t.Errorf("%s: doc %q does not say %q", address, channel.Doc, sentence)
		}
	}
}

func TestReadsRoutesThroughExchangesQueuesAndBindings(t *testing.T) {
	got, warnings := extracted(t, "testdata/rabbit")
	if len(warnings) != 0 {
		t.Errorf("warnings: %v", warnings)
	}
	if len(got) != 4 {
		t.Errorf("channels: got %d, want 4: %v", len(got), got)
	}
	const app = "testdata/rabbit/app/app.go"

	// A topic exchange routes by key: the publisher and the consumer whose
	// queue is bound with that key meet on the key.
	want(t, got, "order.placed", catalog.ChannelKindEvent, "AMQP routing key", app+":35",
		"Read through github.com/rabbitmq/amqp091-go.",
		"Published by `Start` to exchange `shop.events` with routing key `order.placed`.",
		"Consumed by `Billing` from queue `billing.orders`, bound to exchange `shop.events` with key `order.placed` in `Billing`.",
		"Exchange `shop.events` is declared `topic` in `Declare`.")

	// The port: the exchange comes in at the constructor, the key and the
	// message's name at the call through the interface.
	cancelled := got["order.cancelled"]
	want(t, got, "order.cancelled", catalog.ChannelKindEvent, "AMQP routing key", app+":32",
		"Published by `Rabbit.Publish` to exchange `shop.events` with routing key `order.cancelled`.")
	if len(cancelled.Messages) != 1 || cancelled.Messages[0].Name != "orders.OrderCancelled" || cancelled.Messages[0].Direction != catalog.ChannelSend {
		t.Errorf("order.cancelled messages: %+v", cancelled.Messages)
	}

	// A fanout exchange ignores keys: the channel is the exchange, and a
	// queue the server names meets it through the binding on q.Name.
	want(t, got, "logs", catalog.ChannelKindEvent, "AMQP exchange", app+":38",
		"Published by `Start` to exchange `logs`, which does not route by the key `ignored` it is given.",
		"Consumed by `Tail` from a queue the server names, bound to exchange `logs` in `Tail`.",
		"Exchange `logs` is declared `fanout` in `Declare`.")

	// The default exchange delivers a key to the queue of that name, which
	// is where an unbound consumer reads.
	want(t, got, "emails", catalog.ChannelKindMessage, "AMQP queue", app+":43",
		"Published by `Mail` straight to queue `emails` through the default exchange.",
		"Consumed by `Mailer` from queue `emails`.")
}

func TestReadsStreadwayAndConfigDefaults(t *testing.T) {
	got, warnings := extracted(t, "testdata/streadway")
	if len(warnings) != 0 {
		t.Errorf("warnings: %v", warnings)
	}
	if len(got) != 2 {
		t.Errorf("channels: got %d, want 2: %v", len(got), got)
	}
	const jobs = "testdata/streadway/jobs/jobs.go"
	want(t, got, "jobs.resize", catalog.ChannelKindMessage, "AMQP queue", jobs+":20",
		"Read through github.com/streadway/amqp.",
		"Published by `Run` straight to queue `jobs.resize` through the default exchange.",
		"Consumed by `Run` from queue `jobs.resize`.")
	want(t, got, "jobs.retry", catalog.ChannelKindMessage, "AMQP queue", jobs+":23", "Consumed by `Run` from queue `jobs.retry`.")
}

func TestWarnsAboutRoutesItCannotFollow(t *testing.T) {
	got, warnings := extracted(t, "testdata/unresolved")
	if len(got) != 0 {
		t.Errorf("channels: %v", got)
	}
	expected := []string{
		"relay/relay.go:16: exchange or routing key of Publish could not be resolved",
		"relay/relay.go:20: queue of Consume could not be resolved",
		"relay/relay.go:29: Consume reads a queue the server names, and nothing in this tree binds it",
	}
	if len(warnings) != len(expected) {
		t.Fatalf("warnings: %v", warnings)
	}
	for i, prefix := range expected {
		if !strings.HasPrefix(warnings[i], prefix) {
			t.Errorf("warning %d = %q, want prefix %q", i, warnings[i], prefix)
		}
	}
}

func TestWarnsWhenNothingIsFound(t *testing.T) {
	root := t.TempDir()
	for name, contents := range map[string]string{
		"go.mod":     "module example.com/svc\n",
		"app/app.go": "package app\n\ntype Ch struct{}\n\nfunc (Ch) Publish(exchange, key string) {}\n\nfunc Use(c Ch) { c.Publish(\"x\", \"y\") }\n",
	} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, warnings := extracted(t, root)
	if len(got) != 0 {
		t.Errorf("channels: %v", got)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "no amqp091-go or streadway/amqp call was found") {
		t.Errorf("warnings: %v", warnings)
	}
}
