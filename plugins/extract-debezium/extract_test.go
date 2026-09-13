package extractdebezium

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func extracted(t *testing.T, paths []string, opts Options) (catalog.Catalog, plugin.Response) {
	t.Helper()
	opts.Context = "platform"
	opts.Paths = paths
	opts.Broker = "kafka"
	opts.Out = "debezium.json"
	resp, err := extract(plugin.Input{Root: "testdata"}, opts)
	if err != nil {
		t.Fatal(err)
	}
	var fragment catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &fragment); err != nil {
		t.Fatal(err)
	}
	return fragment, resp
}

func serviceNamed(t *testing.T, fragment catalog.Catalog, id string) catalog.Service {
	t.Helper()
	for _, context := range fragment.Contexts {
		for _, service := range context.Services {
			if service.ID == id {
				return service
			}
		}
	}
	t.Fatalf("no service %s", id)
	return catalog.Service{}
}

func warningText(resp plugin.Response) string {
	var out []string
	for _, warning := range resp.Warnings() {
		out = append(out, warning.Message)
	}
	return strings.Join(out, "\n")
}

func TestPostgresCDCBecomesADataPipelineWithTopicsAndFlows(t *testing.T) {
	fragment, resp := extracted(t, []string{"postgres.json"}, Options{Connectors: map[string]ConnectorOptions{
		"orders-cdc": {Store: "shop.orders.pg"},
	}})
	if got := warningText(resp); got != "" {
		t.Fatalf("unexpected warnings: %s", got)
	}
	service := serviceNamed(t, fragment, "platform.orders-cdc")
	if service.Kind != catalog.ComponentKindDataPipeline || strings.Join(service.Technologies, ",") != "Debezium,Kafka Connect,PostgreSQL" {
		t.Fatalf("pipeline identity: %+v", service)
	}
	if len(service.Stores) != 1 || service.Stores[0] != "shop.orders.pg" {
		t.Fatalf("stores: %v", service.Stores)
	}
	if len(service.Channels) != 2 || service.Channels[0].Address != "shop.public.order_lines" || service.Channels[1].Address != "shop.public.orders" {
		t.Fatalf("channels: %+v", service.Channels)
	}
	message := service.Channels[1].Messages[0]
	if message.Name != "shop.public.orders.Value" || message.Encoding != "avro" || message.Direction != catalog.ChannelSend {
		t.Fatalf("message: %+v", message)
	}
	if len(fragment.Flows) != 2 {
		t.Fatalf("flows: %+v", fragment.Flows)
	}
	last := fragment.Flows[1].Steps[1].(*catalog.Step)
	if last.Handoff == nil || last.Handoff.Channel != "shop.public.orders" || last.Handoff.Message != "shop.public.orders.Value" {
		t.Fatalf("handoff: %+v", last.Handoff)
	}
	if strings.Contains(resp.Files[0].Contents, "must-not-leak") || strings.Contains(resp.Files[0].Contents, "database.password") {
		t.Fatal("connector secret leaked into the fragment")
	}
}

func TestOutboxKeepsTheSourceServiceAsLogicalPublisher(t *testing.T) {
	fragment, resp := extracted(t, []string{"outbox.yaml"}, Options{Connectors: map[string]ConnectorOptions{
		"orders-outbox": {
			Store: "shop.orders.pg", SourceService: "shop.orders",
			Routes: []Route{{Value: "orders", Message: "shop.orders.OrderPlaced"}, {Value: "orders", Message: "shop.orders.OrderCancelled"}},
		},
	}})
	if got := warningText(resp); got != "" {
		t.Fatalf("unexpected warnings: %s", got)
	}
	connector := serviceNamed(t, fragment, "platform.orders-outbox")
	if len(connector.Channels) != 0 {
		t.Fatalf("relay became a logical publisher: %+v", connector.Channels)
	}
	publisher := serviceNamed(t, fragment, "shop.orders")
	if len(publisher.Channels) != 1 || publisher.Channels[0].Address != "domain.orders" || publisher.Channels[0].Kind != catalog.ChannelKindEvent {
		t.Fatalf("publisher channels: %+v", publisher.Channels)
	}
	if len(publisher.Channels[0].Messages) != 2 || len(fragment.Flows) != 2 {
		t.Fatalf("outbox messages or flows missing: %+v %+v", publisher.Channels, fragment.Flows)
	}
	for _, flow := range fragment.Flows {
		publish := flow.Steps[1].(*catalog.Step)
		if publish.From != connector.ID || publish.Handoff == nil || publish.Handoff.Channel != "domain.orders" {
			t.Fatalf("outbox transport step: %+v", publish)
		}
	}
	if strings.Contains(resp.Files[0].Contents, "also-must-not-leak") {
		t.Fatal("Strimzi secret leaked into the fragment")
	}
}

func TestDynamicOutboxAndUnboundedCaptureAreReported(t *testing.T) {
	fragment, resp := extracted(t, []string{"outbox.yaml"}, Options{})
	got := warningText(resp)
	for _, want := range []string{"sourceService", ".routes"} {
		if !strings.Contains(got, want) {
			t.Errorf("no warning containing %q in:\n%s", want, got)
		}
	}
	if len(fragment.Flows) != 1 || len(fragment.Flows[0].Steps) != 1 {
		t.Fatalf("the known store-to-connector half should remain visible: %+v", fragment.Flows)
	}
}

func TestIncompleteStrimziConfigIsReadWithoutPanicking(t *testing.T) {
	found, ok := connectorFrom(map[string]any{
		"kind":     "KafkaConnector",
		"metadata": map[string]any{"name": "inventory"},
		"spec":     map[string]any{"class": "io.debezium.connector.postgresql.PostgresConnector"},
	}, "connector.yaml:1")
	if !ok || found.name != "inventory" || found.config["connector.class"] == "" {
		t.Fatalf("incomplete Strimzi declaration: %+v, %t", found, ok)
	}
}
