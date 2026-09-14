package extractgoeventgrid

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
	file := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func extracted(t *testing.T, root string) (catalog.Catalog, plugin.Response) {
	t.Helper()
	resp, err := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "fulfillment"})
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
	got := map[string]catalog.Channel{}
	for _, channel := range out.Contexts[0].Services[0].Channels {
		got[channel.Address] = channel
	}
	return got
}

func warnings(resp plugin.Response) []string {
	var out []string
	for _, warning := range resp.Warnings() {
		out = append(out, warning.Ref+": "+warning.Message)
	}
	return out
}

func TestReadsClassicAndCloudEventPublishers(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "publisher/publisher.go", `package publisher

import (
	"context"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore/messaging"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/to"
	"github.com/Azure/azure-sdk-for-go/sdk/messaging/eventgrid/azeventgrid"
)

const endpoint = "https://orders.chinanorth3-1.eventgrid.azure.cn/api/events"
const placed = "shop.OrderPlaced"

func Native(ctx context.Context, credential *azeventgrid.AzureKeyCredential) error {
	client, err := azeventgrid.NewClientWithSharedKeyCredential(endpoint, credential, nil)
	if err != nil { return err }
	events := []azeventgrid.Event{{EventType: to.Ptr(placed)}}
	return client.PublishEvents(ctx, events, nil)
}

func Cloud(ctx context.Context, credential *azeventgrid.AzureKeyCredential) error {
	client, err := azeventgrid.NewClient(endpoint, credential, nil)
	if err != nil { return err }
	event, err := messaging.NewCloudEvent("/shops/one", "shop.OrderCancelled", []byte("{}"), nil)
	if err != nil { return err }
	return client.PublishCloudEvents(ctx, []messaging.CloudEvent{event}, nil)
}
`)

	out, resp := extracted(t, root)
	if got := warnings(resp); len(got) != 0 {
		t.Fatalf("warnings: %v", got)
	}
	orders := channels(out)["orders"]
	if orders.Title != "Azure Event Grid topic" || orders.Kind != catalog.ChannelKindEvent || orders.Source != "publisher/publisher.go:18" {
		t.Errorf("orders: %+v", orders)
	}
	if !strings.Contains(orders.Doc, eventGridPkg) || !strings.Contains(orders.Doc, "Event Grid schema") || !strings.Contains(orders.Doc, "CloudEvents 1.0") {
		t.Errorf("doc: %s", orders.Doc)
	}
	var messages []string
	for _, message := range orders.Messages {
		messages = append(messages, message.Name+":"+string(message.Direction))
	}
	if got := strings.Join(messages, ","); got != "shop.OrderCancelled:send,shop.OrderPlaced:send" {
		t.Errorf("messages: %s", got)
	}
}

func TestReadsNamespaceSenderAndClientStoredInAdapter(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "publisher/publisher.go", `package publisher

import (
	"context"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/messaging"
	"github.com/Azure/azure-sdk-for-go/sdk/messaging/eventgrid/aznamespaces"
)

type Publisher struct { sender *aznamespaces.SenderClient }

func New(sender *aznamespaces.SenderClient) *Publisher {
	return &Publisher{sender: sender}
}

func (p *Publisher) Send(ctx context.Context, event *messaging.CloudEvent) error {
	return p.sender.SendEvent(ctx, event, nil)
}

func Assemble(credential *azcore.KeyCredential) *Publisher {
	sender, _ := aznamespaces.NewSenderClientWithSharedKeyCredential(
		"https://estate.chinanorth3-1.eventgrid.azure.cn", "orders", credential, nil,
	)
	return New(sender)
}
`)

	out, resp := extracted(t, root)
	if got := warnings(resp); len(got) != 0 {
		t.Fatalf("warnings: %v", got)
	}
	topic := channels(out)["estate/orders"]
	if topic.Title != "Azure Event Grid namespace topic" || topic.Source != "publisher/publisher.go:18" {
		t.Errorf("namespace topic: %+v", topic)
	}
	if !strings.Contains(topic.Doc, namespacesPkg) || !strings.Contains(topic.Doc, "Published as CloudEvents 1.0 by `Publisher.Send`.") {
		t.Errorf("doc: %s", topic.Doc)
	}
}

func TestIgnoresLookalikeAndWarnsWhenPublisherEndpointIsDynamic(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "main.go", `package svc

import (
	"context"
	"github.com/Azure/azure-sdk-for-go/sdk/messaging/eventgrid/azeventgrid"
)

type fake struct{}
func (fake) PublishEvents(context.Context, any, any) error { return nil }

func Run(ctx context.Context, endpoint string, credential *azeventgrid.AzureKeyCredential) error {
	_ = fake{}.PublishEvents(ctx, nil, nil)
	client, err := azeventgrid.NewClient(endpoint, credential, nil)
	if err != nil { return err }
	return client.PublishCustomEventEvents(ctx, []any{"opaque"}, nil)
}
`)

	out, resp := extracted(t, root)
	if got := len(channels(out)); got != 0 {
		t.Errorf("channels: %v", channels(out))
	}
	got := warnings(resp)
	if len(got) != 1 || !strings.Contains(got[0], "topic of PublishCustomEventEvents could not be resolved") {
		t.Errorf("warnings: %v", got)
	}
}
