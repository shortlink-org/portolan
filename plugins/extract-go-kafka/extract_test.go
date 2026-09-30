package extractgokafka

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
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	if resp.Files[0].Name != "kafka.json" {
		t.Errorf("fragment path = %q", resp.Files[0].Name)
	}
	byAddress := map[string]catalog.Channel{}
	for _, channel := range out.Contexts[0].Services[0].Channels {
		if channel.Kind != catalog.ChannelKindMessage || channel.Protocol != "kafka" || channel.Title != "Kafka topic" {
			t.Errorf("%s: kind %q, protocol %q, title %q", channel.Address, channel.Kind, channel.Protocol, channel.Title)
		}
		byAddress[channel.Address] = channel
	}
	var warnings []string
	for _, warning := range resp.Warnings() {
		warnings = append(warnings, warning.Ref+": "+warning.Message)
	}
	return byAddress, warnings
}

// want holds a channel to a source and to each sentence its doc must carry.
func want(t *testing.T, got map[string]catalog.Channel, address, source string, doc ...string) {
	t.Helper()
	channel, ok := got[address]
	if !ok {
		t.Errorf("no channel %q", address)
		return
	}
	if channel.Source != source {
		t.Errorf("%s: source = %q, want %q", address, channel.Source, source)
	}
	for _, sentence := range doc {
		if !strings.Contains(channel.Doc, sentence) {
			t.Errorf("%s: doc %q does not say %q", address, channel.Doc, sentence)
		}
	}
}

func TestReadsSarama(t *testing.T) {
	got, warnings := extracted(t, "testdata/sarama")
	if len(warnings) != 0 {
		t.Errorf("warnings: %v", warnings)
	}
	if len(got) != 6 {
		t.Errorf("channels: got %d, want 6: %v", len(got), got)
	}
	const producer = "testdata/sarama/app/producer.go"
	const consumer = "testdata/sarama/app/consumer.go"
	// A constant of another package, read where the message is built and
	// then handed to SendMessage.
	want(t, got, "billing.invoices", producer+":15", "Read through github.com/IBM/sarama.", "Produced by `Producer.Issue` through sarama.")
	// A message sent down AsyncProducer.Input().
	want(t, got, "billing.audit", producer+":21", "Produced by `Producer.Audit` through sarama.")
	// Elements of a []*sarama.ProducerMessage that leave their type out.
	want(t, got, "billing.batch.first", producer+":26", "Produced by `Producer.Batch`")
	want(t, got, "billing.batch.second", producer+":27", "Produced by `Producer.Batch`")
	want(t, got, "shop.payments.captured", consumer+":17", "Consumed by `Consume` through sarama, consumer group `billing`.")
	// The Shopify import path is the same client.
	want(t, got, "billing.legacy", consumer+":25", "Read through github.com/Shopify/sarama.", "Consumed by `Tail` through sarama, partition by partition with no consumer group.")
	if _, ok := got["not.kafka"]; ok {
		t.Error("a Consume on the service's own type was read as sarama's")
	}
}

func TestReadsKafkaGo(t *testing.T) {
	got, warnings := extracted(t, "testdata/kafkago")
	if len(warnings) != 0 {
		t.Errorf("warnings: %v", warnings)
	}
	if len(got) != 6 {
		t.Errorf("channels: got %d, want 6: %v", len(got), got)
	}
	const app = "testdata/kafkago/app/app.go"
	// A config field's default tag.
	want(t, got, "shop.orders.placed", app+":22", "Consumed by the kafka-go reader built in `App.Start`, consumer group `shipping`.")
	// GroupTopics of a ReaderConfig built into a local first.
	want(t, got, "shop.returns.opened", app+":25", "consumer group `returns`.")
	want(t, got, "shop.returns.closed", app+":25", "consumer group `returns`.")
	// A writer's topic is a constructor parameter, read at the caller.
	want(t, got, "shipping.dispatched", app+":28", "Produced by the kafka-go writer built in `NewShipments`.")
	want(t, got, "shipping.legacy", app+":33", "Produced by the kafka-go writer built in `Legacy`.")

	// The port: the adapter takes the topic and the message's name, the
	// assembly passes both through the interface.
	labels := got["shipping.labels"]
	want(t, got, "shipping.labels", app+":29", "Produced by `Kafka.Publish` through kafka-go.")
	if len(labels.Messages) != 1 || labels.Messages[0].Name != "shipping.LabelPrinted" || labels.Messages[0].Direction != catalog.ChannelSend {
		t.Errorf("shipping.labels messages: %+v", labels.Messages)
	}
}

func TestReadsConfluent(t *testing.T) {
	got, warnings := extracted(t, "testdata/confluent")
	if len(warnings) != 0 {
		t.Errorf("warnings: %v", warnings)
	}
	if len(got) != 4 {
		t.Errorf("channels: got %d, want 4: %v", len(got), got)
	}
	const app = "testdata/confluent/app/app.go"
	// TopicPartition{Topic: &topic}, a local given a constant.
	want(t, got, "fraud.verdicts", app+":10", "Read through github.com/confluentinc/confluent-kafka-go/v2/kafka.", "Produced by `Flag` through confluent-kafka-go.")
	// The group is the ConfigMap's group.id.
	want(t, got, "shop.payments.captured", app+":25", "Consumed by `Listen` through confluent-kafka-go, consumer group `fraud`.")
	want(t, got, "shop.cards.added", app+":25", "consumer group `fraud`.")
	// Subscribe's topic is a parameter, read at the caller.
	want(t, got, "shop.refunds", app+":28", "Consumed by `Follow` through confluent-kafka-go.")
}

func TestReadsFranzGo(t *testing.T) {
	got, warnings := extracted(t, "testdata/franz")
	if len(warnings) != 0 {
		t.Errorf("warnings: %v", warnings)
	}
	if len(got) != 5 {
		t.Errorf("channels: got %d, want 5: %v", len(got), got)
	}
	const app = "testdata/franz/app/app.go"
	// ConsumeTopics takes its group from the ConsumerGroup option beside it.
	want(t, got, "web.clicks", app+":13", "Consumed by `Connect` through franz-go, consumer group `analytics`.")
	want(t, got, "web.views", app+":13", "consumer group `analytics`.")
	want(t, got, "analytics.fallback", app+":14", "Produced by `Connect` through franz-go.")
	want(t, got, "analytics.sessions", app+":19", "Produced by `Record` through franz-go.")
	// A variadic parameter, read at each caller's arguments.
	want(t, got, "web.searches", app+":31", "Consumed by `Watch` through franz-go.")
}

func TestWarnsAboutTopicsItCannotFollow(t *testing.T) {
	got, warnings := extracted(t, "testdata/unresolved")
	if len(got) != 0 {
		t.Errorf("channels: %v", got)
	}
	expected := []string{
		"relay/relay.go:19: topic of sarama.ProducerMessage could not be resolved",
		"relay/relay.go:24: topics of sarama.ConsumerGroup.Consume could not be followed",
		"relay/relay.go:28: topic of kafka.ReaderConfig could not be resolved",
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
		"app/app.go": "package app\n\ntype Writer struct{ Topic string }\n\nfunc New() Writer { return Writer{Topic: \"not.kafka\"} }\n",
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
	if len(warnings) != 1 || !strings.Contains(warnings[0], "no sarama, kafka-go, confluent-kafka-go or franz-go topic was found") {
		t.Errorf("warnings: %v", warnings)
	}
}
