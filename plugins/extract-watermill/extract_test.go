package main

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
	resp, err := extract(plugin.Input{Root: root, Commit: "abc", GeneratedAt: "2026-01-01T00:00:00Z"}, Options{Context: "sales", Service: "mailer"})
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
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/mailer\n")
	write(t, root, "config/config.go", `package config
type Bus struct {
  Input string `+"`envconfig:\"MAIL_INPUT_TOPIC\" default:\"mail.input\"`"+`
  Output string `+"`envconfig:\"MAIL_OUTPUT_TOPIC\" default:\"mail.output\"`"+`
  Errors string `+"`envconfig:\"MAIL_ERROR_TOPIC\" default:\"mail.error\"`"+`
}
`)
	write(t, root, "api/messages.go", `package api
type Input struct {
  ID string `+"`json:\"id\"`"+`
  Valid bool `+"`json:\"valid\"`"+`
}
type Output struct { Accepted bool `+"`json:\"accepted\"`"+` }
type Failure struct { Reason string `+"`json:\"reason\"`"+` }
`)
	write(t, root, "app/router.go", `package app
import (
  "encoding/json"
  "github.com/ThreeDotsLabs/watermill"
  "github.com/ThreeDotsLabs/watermill/message"
  "example.com/mailer/api"
  "example.com/mailer/config"
)
const ConsumerGroup = "mail-workers"
func NewSubscriber(config.Bus, string) (message.Subscriber, error) { return nil, nil }
func publishFailure(pub message.Publisher, topic string) error {
  value := api.Failure{Reason: "bad"}
  payload, _ := json.Marshal(value)
  msg := message.NewMessage(watermill.NewUUID(), payload)
  return pub.Publish(topic, msg)
}
func Register(r *message.Router, cfg config.Bus, pub message.Publisher) {
  sub, _ := NewSubscriber(cfg, ConsumerGroup)
  handlerName := "mail_router"
  r.AddHandler(handlerName, cfg.Input, sub, "", nil, func(msg *message.Message) ([]*message.Message, error) {
    var input api.Input
    _ = json.Unmarshal(msg.Payload, &input)
    if !input.Valid {
      _ = publishFailure(pub, cfg.Errors)
      return nil, nil
    }
    value := api.Output{Accepted: true}
    payload, _ := json.Marshal(value)
    out := message.NewMessage(watermill.NewUUID(), payload)
    _ = pub.Publish(cfg.Output, out)
    return nil, nil
  })
}
`)

	out, _ := extracted(t, root)
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
