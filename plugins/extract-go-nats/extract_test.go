package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func write(t *testing.T, root, name, contents string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func extracted(t *testing.T, root string) (catalog.Catalog, plugin.Response) {
	t.Helper()
	resp, err := extract(plugin.Input{Root: root, Commit: "abc", GeneratedAt: "2026-01-01T00:00:00Z"}, Options{Context: "shop", Service: "pricing"})
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	return out, resp
}

func channels(out catalog.Catalog) map[string]catalog.Channel {
	byAddress := map[string]catalog.Channel{}
	for _, channel := range out.Contexts[0].Services[0].Channels {
		byAddress[channel.Address] = channel
	}
	return byAddress
}

func warnings(resp plugin.Response) []string {
	var out []string
	for _, warning := range resp.Warnings() {
		out = append(out, warning.Ref+": "+warning.Message)
	}
	return out
}

func TestReadsCoreCallsWithLiteralsConstantsAndMessages(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "topics/topics.go", "package topics\n\nconst Orders = \"orders.placed\"\n")
	write(t, root, "app/app.go", `package app

import (
	"github.com/nats-io/nats.go"

	"example.com/svc/topics"
)

type App struct {
	nc *nats.Conn
}

func (a *App) Run() error {
	if _, err := a.nc.QueueSubscribe(topics.Orders, "workers", func(m *nats.Msg) {}); err != nil {
		return err
	}
	msg := nats.NewMsg("orders.shipped")
	msg.Data = []byte("{}")
	return a.nc.PublishMsg(msg)
}

func Direct(nc *nats.Conn) error {
	return nc.Publish("audit.log", nil)
}
`)

	out, resp := extracted(t, root)
	if len(resp.Warnings()) != 0 {
		t.Errorf("warnings: %v", warnings(resp))
	}
	got := channels(out)
	if len(got) != 3 {
		t.Fatalf("channels: got %d, want 3", len(got))
	}

	orders := got["orders.placed"]
	if orders.Title != "NATS subject" || orders.Kind != catalog.ChannelKindEvent {
		t.Errorf("orders.placed: %+v", orders)
	}
	if orders.Source != "app/app.go:14" {
		t.Errorf("orders.placed source: %q", orders.Source)
	}
	if !strings.Contains(orders.Doc, "Subscribed by `App.Run`, queue group `workers`.") {
		t.Errorf("orders.placed doc: %q", orders.Doc)
	}
	if len(orders.Messages) != 0 {
		t.Errorf("a direct call names no message, got %v", orders.Messages)
	}
	if !strings.Contains(got["orders.shipped"].Doc, "Published by `App.Run`.") {
		t.Errorf("orders.shipped doc: %q", got["orders.shipped"].Doc)
	}
	if audit := got["audit.log"]; !strings.Contains(audit.Doc, "Published by `Direct`.") || audit.Source != "app/app.go:23" {
		t.Errorf("audit.log: %+v", audit)
	}
}

// The port: the adapter takes the subject and the name as parameters, the
// assembly hands it constants through the interface, and the channel is
// read at the assembly with the message the assembly named.
func TestFollowsTheSubjectThroughThePort(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "bus/bus.go", `package bus

import "context"

type Handler func(ctx context.Context, data []byte) error

type Bus interface {
	Publish(ctx context.Context, topic, name string, payload []byte) error
	Subscribe(ctx context.Context, topic, name string, handler Handler) error
}
`)
	write(t, root, "bus/nats.go", `package bus

import (
	"context"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

type NATS struct {
	name string
	conn *nats.Conn
	js   jetstream.JetStream
}

func (b *NATS) stream(ctx context.Context, subject string) (jetstream.Stream, error) {
	return b.js.Stream(ctx, "shop")
}

func (b *NATS) Publish(ctx context.Context, topic, name string, payload []byte) error {
	msg := nats.NewMsg(topic)
	msg.Data = payload
	_, err := b.js.PublishMsg(ctx, msg)
	return err
}

func (b *NATS) Subscribe(ctx context.Context, topic, name string, handler Handler) error {
	stream, err := b.stream(ctx, topic)
	if err != nil {
		return err
	}
	durable := b.name + "-" + name
	_, err = stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{Durable: durable, FilterSubject: topic, AckPolicy: jetstream.AckExplicitPolicy})
	return err
}
`)
	write(t, root, "bus/log.go", `package bus

import "context"

type Log struct{}

func (Log) Publish(ctx context.Context, topic, name string, payload []byte) error { return nil }

func (Log) Subscribe(ctx context.Context, topic, name string, handler Handler) error { return nil }
`)
	write(t, root, "cart/events.go", `package cart

const Topic = "shop.cart.basket"

type BasketCheckedOut struct{}

func (BasketCheckedOut) Name() string { return "cart.BasketCheckedOut" }
`)
	write(t, root, "di/app.go", `package di

import (
	"context"

	"example.com/svc/bus"
	"example.com/svc/cart"
)

type App struct {
	bus bus.Bus
}

func (a *App) Start(ctx context.Context) error {
	if err := a.bus.Subscribe(ctx, cart.Topic, cart.BasketCheckedOut{}.Name(), a.handle); err != nil {
		return err
	}
	return a.bus.Publish(ctx, "shop.pricing.quote", "pricing.QuoteIssued", nil)
}

func (a *App) handle(ctx context.Context, data []byte) error { return nil }
`)

	out, resp := extracted(t, root)
	if len(resp.Warnings()) != 0 {
		t.Errorf("warnings: %v", warnings(resp))
	}
	got := channels(out)
	if len(got) != 2 {
		t.Fatalf("channels: got %v", got)
	}

	basket := got["shop.cart.basket"]
	if basket.Title != "JetStream subject" || basket.Source != "di/app.go:15" {
		t.Errorf("basket: %+v", basket)
	}
	if !strings.Contains(basket.Doc, "Subscribed by `NATS.Subscribe` over JetStream.") {
		t.Errorf("basket doc: %q", basket.Doc)
	}
	if len(basket.Messages) != 1 || basket.Messages[0].Name != "cart.BasketCheckedOut" || basket.Messages[0].Direction != catalog.ChannelReceive {
		t.Errorf("basket messages: %+v", basket.Messages)
	}

	quote := got["shop.pricing.quote"]
	if quote.Source != "di/app.go:18" || !strings.Contains(quote.Doc, "Published by `NATS.Publish` over JetStream.") {
		t.Errorf("quote: %+v", quote)
	}
	if len(quote.Messages) != 1 || quote.Messages[0].Name != "pricing.QuoteIssued" || quote.Messages[0].Direction != catalog.ChannelSend {
		t.Errorf("quote messages: %+v", quote.Messages)
	}
}

func TestReadsTheLegacyJetStreamAPIAndConfigDefaults(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "app/app.go", `package app

import "github.com/nats-io/nats.go"

type Config struct {
	Jobs string `+"`envconfig:\"JOBS_SUBJECT\" default:\"jobs.run\"`"+`
}

func Run(nc *nats.Conn, cfg Config) error {
	js, err := nc.JetStream()
	if err != nil {
		return err
	}
	if _, err := js.PullSubscribe(cfg.Jobs, "worker"); err != nil {
		return err
	}
	if _, err := js.Subscribe("jobs.retry", func(m *nats.Msg) {}, nats.Durable("retrier")); err != nil {
		return err
	}
	_, err = js.Publish("jobs.done", nil)
	return err
}
`)

	out, resp := extracted(t, root)
	if len(resp.Warnings()) != 0 {
		t.Errorf("warnings: %v", warnings(resp))
	}
	got := channels(out)
	if len(got) != 3 {
		t.Fatalf("channels: got %v", got)
	}
	if jobs := got["jobs.run"]; jobs.Title != "JetStream subject" || !strings.Contains(jobs.Doc, "Subscribed by `Run` over JetStream, durable consumer `worker`.") {
		t.Errorf("jobs.run: %+v", jobs)
	}
	if retry := got["jobs.retry"]; !strings.Contains(retry.Doc, "durable consumer `retrier`.") {
		t.Errorf("jobs.retry: %+v", retry)
	}
	if done := got["jobs.done"]; !strings.Contains(done.Doc, "Published by `Run` over JetStream.") {
		t.Errorf("jobs.done: %+v", done)
	}
}

func TestWarnsAboutASubjectItCannotFollow(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "relay/relay.go", `package relay

import "github.com/nats-io/nats.go"

type Row struct {
	Topic   string
	Payload []byte
}

func Deliver(nc *nats.Conn, row Row) error {
	return nc.Publish(row.Topic, row.Payload)
}
`)

	out, resp := extracted(t, root)
	if got := channels(out); len(got) != 0 {
		t.Errorf("channels: %v", got)
	}
	notes := warnings(resp)
	if len(notes) != 1 || !strings.HasPrefix(notes[0], "relay/relay.go:11: subject of Publish could not be resolved") {
		t.Errorf("warnings: %v", notes)
	}
}

func TestIgnoresASubscribeThatIsNotNATS(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "app/app.go", `package app

type Other struct{}

func (Other) Subscribe(subject string) {}

func Use(o Other) {
	o.Subscribe("not.nats")
}
`)

	out, resp := extracted(t, root)
	if got := channels(out); len(got) != 0 {
		t.Errorf("channels: %v", got)
	}
	notes := warnings(resp)
	if len(notes) != 1 || !strings.Contains(notes[0], "no nats.go or JetStream call was found") {
		t.Errorf("warnings: %v", notes)
	}
}

// A name given an expression of itself in an inner block is what the
// assignment index sees last, and following it must end.
func TestALocalShadowedByItselfDoesNotLoop(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "app/app.go", `package app

import "github.com/nats-io/nats.go"

func Run(nc *nats.Conn) error {
	js := nc
	if nc != nil {
		js := js.Barrier()
		_ = js
	}
	return nc.Publish("still.read", nil)
}
`)

	out, _ := extracted(t, root)
	if got := channels(out); len(got) != 1 || got["still.read"].Address == "" {
		t.Errorf("channels: %v", got)
	}
}

func TestOutputDoesNotDependOnDeclarationOrder(t *testing.T) {
	first := t.TempDir()
	second := t.TempDir()
	for i, root := range []string{first, second} {
		write(t, root, "go.mod", "module example.com/svc\n")
		a := "func A(nc *nats.Conn) { nc.Publish(\"a.first\", nil) }\n"
		b := "func B(nc *nats.Conn) { nc.Subscribe(\"b.second\", nil) }\n"
		body := a + b
		if i == 1 {
			body = b + a
		}
		write(t, root, "app/app.go", "package app\n\nimport \"github.com/nats-io/nats.go\"\n\n"+body)
	}
	// The lines move with the declarations; everything else must not.
	one, _ := extracted(t, first)
	two, _ := extracted(t, second)
	forget := func(out catalog.Catalog) []catalog.Channel {
		channels := out.Contexts[0].Services[0].Channels
		for i := range channels {
			channels[i].Source = ""
		}
		return channels
	}
	if got, want := forget(one), forget(two); !reflect.DeepEqual(got, want) {
		t.Errorf("declaration order changed the output:\n%+v\n%+v", got, want)
	}
	if addresses := forget(one); addresses[0].Address != "a.first" || addresses[1].Address != "b.second" {
		t.Errorf("channels are not sorted by address: %+v", addresses)
	}
}
