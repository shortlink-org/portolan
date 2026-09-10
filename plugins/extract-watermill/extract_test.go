package extractwatermill

import (
	"encoding/json"
	"os"
	"path/filepath"
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
	resp, err := extract(plugin.Input{Root: root}, Options{Context: "sales", Service: "mailer"})
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	return out, resp
}

func TestExtractsConfiguredHandlerAndHelperPublications(t *testing.T) {
	out, _ := extracted(t, "testdata/mailer")
	service := out.Contexts[0].Services[0]
	if len(service.Channels) != 3 {
		t.Fatalf("channels = %+v", service.Channels)
	}
	byAddress := map[string]catalog.Channel{}
	for _, channel := range service.Channels {
		byAddress[channel.Address] = channel
	}
	if got := byAddress["mail.input"].Messages[0]; got.Direction != catalog.ChannelReceive || got.Name != "Input" || !strings.Contains(got.Doc, "id string") {
		t.Fatalf("input = %+v", got)
	}
	if got := byAddress["mail.output"].Messages[0]; got.Direction != catalog.ChannelSend || got.Name != "Output" {
		t.Fatalf("output = %+v", got)
	}
	if got := byAddress["mail.error"].Messages[0]; got.Name != "Failure" || !strings.Contains(got.Doc, "reason string") {
		t.Fatalf("error = %+v", got)
	}
	if !strings.Contains(byAddress["mail.input"].Doc, "MAIL_INPUT_TOPIC") {
		t.Fatalf("channel doc = %q", byAddress["mail.input"].Doc)
	}
	if len(out.Flows) != 1 {
		t.Fatalf("flows = %+v", out.Flows)
	}
	flow := out.Flows[0]
	if len(flow.Steps) != 2 || !strings.Contains(flow.Steps[0].(*catalog.Step).Note, "mail-workers") {
		t.Fatalf("flow = %+v", flow)
	}
	branches := flow.Steps[1].(*catalog.Alt).Branches
	if len(branches) != 2 || branches[0].Title != "!input.Valid" || branches[1].Title != "not (!input.Valid)" || !branches[0].Terminal {
		t.Fatalf("branches = %+v", branches)
	}
	receive := flow.Steps[0].(*catalog.Step).Handoff
	errorSend := branches[0].Steps[0].(*catalog.Step).Handoff
	successSend := branches[1].Steps[0].(*catalog.Step).Handoff
	if receive == nil || receive.Direction != "receive" || receive.Transport != "watermill" || receive.Channel != "mail.input" {
		t.Fatalf("receive handoff = %+v", receive)
	}
	if errorSend == nil || errorSend.Direction != "send" || errorSend.Channel != "mail.error" || successSend == nil || successSend.Channel != "mail.output" {
		t.Fatalf("publish handoffs = error %+v, success %+v", errorSend, successSend)
	}
}

func TestExtractsNamedNoPublisherHandler(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/consumer\n")
	write(t, root, "consumer.go", `package consumer
import (
  "encoding/json"
  "github.com/ThreeDotsLabs/watermill/message"
)
type Notice struct { Code string `+"`json:\"code\"`"+` }
func consume(msg *message.Message) error {
  var notice Notice
  return json.Unmarshal(msg.Payload, &notice)
}
func Register(r *message.Router, sub message.Subscriber) {
  r.AddNoPublisherHandler("notice_handler", "notice.input", sub, consume)
}
`)

	out, _ := extracted(t, root)
	service := out.Contexts[0].Services[0]
	if len(service.Channels) != 1 || service.Channels[0].Messages[0].Name != "Notice" {
		t.Fatalf("channels = %+v", service.Channels)
	}
	if len(out.Flows) != 1 || len(out.Flows[0].Steps) != 1 {
		t.Fatalf("flows = %+v", out.Flows)
	}
	if got := out.Flows[0].Steps[0].(*catalog.Step).ContinuesAt; got != "consume" {
		t.Fatalf("handler continuation = %q", got)
	}
	if got := out.Flows[0].Steps[0].(*catalog.Step).Handoff; got == nil || got.Kind != "message" || got.Channel != "notice.input" || got.Direction != "receive" {
		t.Fatalf("handler handoff = %+v", got)
	}
}

func TestEmptyExtractionWritesEmptyFlowArray(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/consumer\n")

	out, resp := extracted(t, root)
	if len(out.Flows) != 0 {
		t.Fatalf("unexpected flows: %+v", out.Flows)
	}
	if !strings.Contains(resp.Files[0].Contents, `"flows": []`) {
		t.Fatalf("empty flows were not encoded as an array: %s", resp.Files[0].Contents)
	}
}

func TestExtractsGenericCQRSProcessors(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/cqrsapp\n")
	write(t, root, "cqrs.go", `package cqrsapp
import (
  "context"
  "github.com/ThreeDotsLabs/watermill/components/cqrs"
  "github.com/ThreeDotsLabs/watermill/message"
)
type OrderPlaced struct { OrderID string `+"`json:\"order_id\"`"+` }
type BookOrder struct { CustomerID string `+"`json:\"customer_id\"`"+` }
func Register(router *message.Router) {
  events, _ := cqrs.NewEventProcessorWithConfig(router, cqrs.EventProcessorConfig{
    GenerateSubscribeTopic: func(cqrs.EventProcessorGenerateSubscribeTopicParams) (string, error) { return "domain.events", nil },
  })
  project := cqrs.NewEventHandler("project_order", func(ctx context.Context, event *OrderPlaced) error { return nil })
  _ = events.AddHandlers(project)

  commands, _ := cqrs.NewCommandProcessorWithConfig(router, cqrs.CommandProcessorConfig{
    GenerateSubscribeTopic: func(params cqrs.CommandProcessorGenerateSubscribeTopicParams) (string, error) { return params.CommandName, nil },
  })
  book := cqrs.NewCommandHandler("book_order", func(ctx context.Context, command *BookOrder) error { return nil })
  _, _ = commands.AddHandler(book)
}
`)

	out, _ := extracted(t, root)
	service := out.Contexts[0].Services[0]
	if len(service.Channels) != 2 {
		t.Fatalf("channels = %+v", service.Channels)
	}
	byAddress := map[string]catalog.Channel{}
	for _, channel := range service.Channels {
		byAddress[channel.Address] = channel
	}
	if got := byAddress["domain.events"].Messages[0]; got.Name != "OrderPlaced" || got.Direction != catalog.ChannelReceive {
		t.Fatalf("event = %+v", got)
	}
	if got := byAddress["BookOrder"].Messages[0]; got.Name != "BookOrder" || got.Direction != catalog.ChannelReceive {
		t.Fatalf("command = %+v", got)
	}
	if len(out.Flows) != 2 {
		t.Fatalf("flows = %+v", out.Flows)
	}
}

func TestBranchesRequireSourceBackedConditions(t *testing.T) {
	unstructured := []publication{
		{topic: topic{address: "one"}, payload: "One"},
		{topic: topic{address: "two"}, payload: "Two"},
	}
	if structuredBranches(unstructured) {
		t.Fatal("two publications without control-flow evidence became an alt")
	}

	structured := []publication{
		{topic: topic{address: "errors"}, conditions: []string{"ready", "err != nil"}},
		{topic: topic{address: "success"}, conditions: []string{"ready", "not (err != nil)"}},
	}
	if !structuredBranches(structured) {
		t.Fatal("complementary source paths did not become an alt")
	}
	got := branchConditions(structured)
	if got[0] != "err != nil" || got[1] != "not (err != nil)" {
		t.Fatalf("branch conditions = %v", got)
	}
}

func TestFollowsRegistrationsThroughWrappersMethodValuesAndConfig(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/orders\n")
	write(t, root, "config/config.go", `package config
type Kafka struct {
  Orders string `+"`envconfig:\"ORDERS_TOPIC\" default:\"orders.placed\"`"+`
}
type Config struct { Kafka Kafka }
`)
	write(t, root, "topics/topics.go", `package topics
type Name string
const Prefix = "shop"
const Shipped Name = "shop.shipped"
`)
	write(t, root, "handlers/order.go", `package handlers
import (
  "encoding/json"
  "github.com/ThreeDotsLabs/watermill/message"
)
type OrderPlaced struct { ID string `+"`json:\"id\"`"+` }
type Handlers struct{}
func (h *Handlers) OnOrder(msg *message.Message) error {
  var placed OrderPlaced
  return json.Unmarshal(msg.Payload, &placed)
}
func OnShipped(msg *message.Message) error { return nil }
`)
	write(t, root, "app/wire.go", `package app
import (
  "context"
  "os"
  "encoding/json"
  "github.com/ThreeDotsLabs/watermill"
  "github.com/ThreeDotsLabs/watermill/message"
  "example.com/orders/config"
  "example.com/orders/handlers"
  "example.com/orders/topics"
)
type Module struct { sub message.Subscriber; pub message.Publisher; h *handlers.Handlers }
type Refund struct { ID string `+"`json:\"id\"`"+` }

func (m *Module) handle(r *message.Router, name, topic string, fn message.NoPublishHandlerFunc) {
  r.AddNoPublisherHandler(name, topic, m.sub, fn)
}

func (m *Module) Register(r *message.Router, cfg config.Config) {
  m.handle(r, "on_order", cfg.Kafka.Orders, m.h.OnOrder)
  m.handle(r, "on_shipped", string(topics.Shipped), handlers.OnShipped)
  r.AddHandler("forward", topics.Prefix+".returns", m.sub, topics.Prefix+".refunds", m.pub, func(msg *message.Message) ([]*message.Message, error) { return nil, nil })
  r.AddNoPublisherHandler("dynamic", os.Getenv("DYNAMIC_TOPIC"), m.sub, handlers.OnShipped)
}

func (m *Module) Listen(ctx context.Context) {
  messages, _ := m.sub.Subscribe(ctx, "shop.audit")
  for msg := range messages { _ = msg }
}

func (m *Module) Refund(id string) error {
  payload, _ := json.Marshal(Refund{ID: id})
  return m.pub.Publish("shop.refunds", message.NewMessage(watermill.NewUUID(), payload))
}
`)

	out, resp := extracted(t, root)
	service := out.Contexts[0].Services[0]
	byAddress := map[string]catalog.Channel{}
	for _, channel := range service.Channels {
		byAddress[channel.Address] = channel
	}
	var addresses []string
	for address := range byAddress {
		addresses = append(addresses, address)
	}
	// Through the wrapper: a nested config default, and a typed constant
	// through string(); the callbacks are a method value and a function of
	// another package, so the payload is read from their bodies.
	if got := byAddress["orders.placed"]; len(got.Messages) != 1 || got.Messages[0].Name != "OrderPlaced" || !strings.Contains(got.Doc, "ORDERS_TOPIC") {
		t.Fatalf("orders.placed = %+v (channels %v)", got, addresses)
	}
	if got := byAddress["shop.shipped"]; len(got.Messages) != 1 || got.Messages[0].Direction != catalog.ChannelReceive {
		t.Fatalf("shop.shipped = %+v", got)
	}
	// AddHandler's publish topic, and constants concatenated on both sides.
	if got := byAddress["shop.returns"]; len(got.Messages) != 1 || got.Messages[0].Direction != catalog.ChannelReceive {
		t.Fatalf("shop.returns = %+v", got)
	}
	refunds := byAddress["shop.refunds"]
	if len(refunds.Messages) != 2 || refunds.Messages[0].Name != "message" || refunds.Messages[1].Name != "Refund" || refunds.Messages[1].Direction != catalog.ChannelSend {
		t.Fatalf("shop.refunds = %+v", refunds)
	}
	// A direct Subscribe is a receive too.
	if got := byAddress["shop.audit"]; len(got.Messages) != 1 || got.Messages[0].Name != "Listen" {
		t.Fatalf("shop.audit = %+v", got)
	}
	if len(service.Channels) != 5 {
		t.Fatalf("channels = %v", addresses)
	}

	flows := map[string]catalog.Flow{}
	for _, flow := range out.Flows {
		flows[flow.Slug] = flow
	}
	// The topic from the environment is not resolvable; the handler stays,
	// with its receive unresolved and no channel claimed.
	dynamic, ok := flows["mailer-watermill-dynamic-consume"]
	if !ok {
		t.Fatalf("dynamic flow missing: %v", keysOf(flows))
	}
	step := dynamic.Steps[0].(*catalog.Step)
	if step.Status != catalog.StatusUnresolved || step.From != "watermill" || step.Handoff.Channel != "" || !strings.Contains(step.Note, `os.Getenv("DYNAMIC_TOPIC")`) {
		t.Fatalf("dynamic step = %+v", step)
	}
	if got := flows["mailer-watermill-on-order-consume"].Steps[0].(*catalog.Step).ContinuesAt; got != "handlers:Handlers.OnOrder" {
		t.Fatalf("on_order continuation = %q", got)
	}
	if got := flows["mailer-watermill-listen-consume"].Steps[0].(*catalog.Step); got.ContinuesAt != "app:Module.Listen" || !strings.Contains(got.Note, "without a router") {
		t.Fatalf("listen step = %+v", got)
	}
	warnings := []string{}
	for _, warning := range resp.Warnings() {
		warnings = append(warnings, warning.Message)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "handler dynamic is registered on topic `os.Getenv(\"DYNAMIC_TOPIC\")`") {
		t.Fatalf("warnings = %v", warnings)
	}
}

func keysOf(flows map[string]catalog.Flow) []string {
	out := []string{}
	for key := range flows {
		out = append(out, key)
	}
	return out
}
