package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

const estate = "testdata/estate"

func fragmentFrom(t *testing.T, opts Options) (catalog.Catalog, plugin.Response) {
	t.Helper()

	resp, err := extract(plugin.Input{Root: estate, Commit: "abc123", GeneratedAt: "2026-09-05T00:00:00Z"}, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Files) != 1 {
		t.Fatalf("the extractor named %d files, want 1", len(resp.Files))
	}

	var fragment catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &fragment); err != nil {
		t.Fatal(err)
	}

	return fragment, resp
}

func defaults() Options {
	return Options{Context: "shop", Service: "oms", Paths: []string{"vendor/schemas"}}
}

func channelsOf(t *testing.T, fragment catalog.Catalog) []catalog.Channel {
	t.Helper()

	if len(fragment.Contexts) != 1 || len(fragment.Contexts[0].Services) != 1 {
		t.Fatalf("the fragment does not describe one service: %+v", fragment.Contexts)
	}

	return fragment.Contexts[0].Services[0].Channels
}

func fieldsOf(t *testing.T, fragment catalog.Catalog, name string) []catalog.Field {
	t.Helper()

	def, known := fragment.Defs[name]
	if !known {
		var held []string
		for key := range fragment.Defs {
			held = append(held, key)
		}
		t.Fatalf("no def named %s; the fragment holds %v", name, held)
	}

	return def.Fields
}

func fieldNamed(t *testing.T, fields []catalog.Field, name string) catalog.Field {
	t.Helper()

	for _, field := range fields {
		if field.Name == name {
			return field
		}
	}
	t.Fatalf("no field named %s in %+v", name, fields)

	return catalog.Field{}
}

func TestTopicsComeFromSubjects(t *testing.T) {
	fragment, _ := fragmentFrom(t, defaults())

	channels := channelsOf(t, fragment)
	if len(channels) != 3 {
		t.Fatalf("channels: %+v", channels)
	}

	// Sorted by address, so the fragment is the same on every run.
	var addresses []string
	for _, channel := range channels {
		addresses = append(addresses, channel.Address)
	}
	if got := strings.Join(addresses, ","); got != "shop.oms.order,shop.oms.route,shop.oms.shipment" {
		t.Errorf("addresses %q", got)
	}

	orders := channels[0]
	// The key subject shares the topic with the value one and adds no message:
	// a key is part of every message on the channel, not a message on it.
	if len(orders.Messages) != 1 {
		t.Fatalf("shop.oms.order carries %+v", orders.Messages)
	}
	if orders.Messages[0].Name != "shop.oms.OrderPlaced" {
		t.Errorf("message name %q", orders.Messages[0].Name)
	}
	if orders.Messages[0].Direction != catalog.ChannelSend {
		t.Errorf("direction %q, want send by default", orders.Messages[0].Direction)
	}
	if !strings.Contains(orders.Messages[0].Doc, "version 3") {
		t.Errorf("the message does not say which registration it is: %q", orders.Messages[0].Doc)
	}
	if orders.Source != "testdata/estate/vendor/schemas/shop.oms.order-value/v3.avsc" {
		t.Errorf("source %q", orders.Source)
	}
}

func TestDirectionIsToldPerSubject(t *testing.T) {
	opts := defaults()
	opts.Direction = "send"
	opts.Subjects = map[string]string{"shop.oms.shipment-value": "receive"}

	fragment, _ := fragmentFrom(t, opts)

	for _, channel := range channelsOf(t, fragment) {
		want := catalog.ChannelSend
		if channel.Address == "shop.oms.shipment" {
			want = catalog.ChannelReceive
		}
		for _, message := range channel.Messages {
			if message.Direction != want {
				t.Errorf("%s carries %s %s, want %s", channel.Address, message.Name, message.Direction, want)
			}
		}
	}
}

func TestAvroShapesLandInDefs(t *testing.T) {
	fragment, _ := fragmentFrom(t, defaults())

	fields := fieldsOf(t, fragment, "shop.oms.OrderPlaced")

	for _, want := range []catalog.Field{
		{Name: "order_id", Type: "string", Doc: "The order's own id."},
		{Name: "note", Type: "string?", Doc: "What the customer wrote in the box."},
		{Name: "labels", Type: "map<string, string>"},
		{Name: "placed_at", Type: "timestamp-millis"},
		{Name: "total", Type: "decimal(12,2)"},
	} {
		got := fieldNamed(t, fields, want.Name)
		if got.Type != want.Type || got.Doc != want.Doc {
			t.Errorf("%s is %+v, want type %q doc %q", want.Name, got, want.Type, want.Doc)
		}
	}

	// A record vendored as its own subject is a shape this one points at, and
	// the ref is what makes the two one shape rather than two.
	buyer := fieldNamed(t, fields, "buyer")
	if buyer.Type != "shop.oms.Party" || buyer.Ref != "shop.oms.Party" {
		t.Errorf("buyer is %+v", buyer)
	}
	if got := fieldsOf(t, fragment, "shop.oms.Party"); len(got) != 2 {
		t.Errorf("shop.oms.Party: %+v", got)
	}

	// A record inlined in a field gets its own def, under the namespace it
	// inherits rather than none.
	lines := fieldNamed(t, fields, "lines")
	if lines.Type != "shop.oms.Line[]" || lines.Ref != "" {
		t.Errorf("lines is %+v", lines)
	}
	if got := fieldsOf(t, fragment, "shop.oms.Line"); len(got) != 2 {
		t.Errorf("shop.oms.Line: %+v", got)
	}

	// Field order is the order the schema lists them in - it is the producer's
	// statement about the record, and re-sorting it would lose that.
	var order []string
	for _, field := range fields {
		order = append(order, field.Name)
	}
	if got := strings.Join(order, ","); got != "order_id,buyer,note,lines,labels,placed_at,total" {
		t.Errorf("field order %q", got)
	}
}

func TestJSONSchemaShapesLandInDefs(t *testing.T) {
	fragment, _ := fragmentFrom(t, defaults())

	fields := fieldsOf(t, fragment, "shop.oms.ShipmentBooked")

	// The order the document writes its properties in, which decoding into a
	// map would have lost.
	var order []string
	for _, field := range fields {
		order = append(order, field.Name)
	}
	if got := strings.Join(order, ","); got != "shipment_id,carrier,booked_at,weight_kg,stops,address" {
		t.Errorf("property order %q", got)
	}

	for _, want := range []catalog.Field{
		{Name: "shipment_id", Type: "string", Doc: "The booking's own id."},
		{Name: "booked_at", Type: "date-time?"},
		{Name: "weight_kg", Type: "number?"},
		{Name: "stops", Type: "string[]?"},
	} {
		got := fieldNamed(t, fields, want.Name)
		if got.Type != want.Type || got.Doc != want.Doc {
			t.Errorf("%s is %+v, want type %q doc %q", want.Name, got, want.Type, want.Doc)
		}
	}

	// A $ref resolves to the definition the document keeps to one side.
	// The label stays the name the document uses; the ref carries the key the
	// catalog files it under, which is qualified because `definitions` is
	// local to a document and `defs` is not.
	carrier := fieldNamed(t, fields, "carrier")
	if carrier.Type != "Carrier" || carrier.Ref != "shop.oms.ShipmentBooked.Carrier" {
		t.Errorf("carrier is %+v", carrier)
	}
	if got := fieldsOf(t, fragment, "shop.oms.ShipmentBooked.Carrier"); len(got) != 2 {
		t.Errorf("Carrier: %+v", got)
	}

	// An object inlined with no title is still a shape; it is named for where
	// it sits.
	address := fieldNamed(t, fields, "address")
	if address.Ref != "shop.oms.ShipmentBooked.address" {
		t.Errorf("address is %+v", address)
	}
	inner := fieldsOf(t, fragment, "shop.oms.ShipmentBooked.address")
	if fieldNamed(t, inner, "line1").Type != "string" {
		t.Errorf("line1 is %+v", fieldNamed(t, inner, "line1"))
	}
	if fieldNamed(t, inner, "postcode").Type != "string?" {
		t.Errorf("postcode is not optional: %+v", fieldNamed(t, inner, "postcode"))
	}
}

func TestProtobufIsNamedButNotShaped(t *testing.T) {
	fragment, resp := fragmentFrom(t, defaults())

	// The topic is still a fact, and it is the one thing extract-proto cannot
	// say: a .proto file does not know which topic it was registered against.
	var found bool
	for _, channel := range channelsOf(t, fragment) {
		if channel.Address == "shop.oms.route" {
			found = true
			if len(channel.Messages) != 1 || channel.Messages[0].Name != "shop.oms.route-value" {
				t.Errorf("shop.oms.route carries %+v", channel.Messages)
			}
		}
	}
	if !found {
		t.Error("the protobuf subject named no topic")
	}

	var said bool
	for _, warning := range resp.Warnings() {
		if strings.Contains(warning.Message, "extract-proto") {
			said = true
		}
	}
	if !said {
		t.Errorf("nothing pointed at extract-proto for the shape: %+v", resp.Warnings())
	}
}

func TestRecordStrategyNamesNoTopic(t *testing.T) {
	opts := defaults()
	opts.Strategy = StrategyRecord

	fragment, _ := fragmentFrom(t, opts)

	// RecordNameStrategy says nothing about topics on purpose - a record under
	// it is reusable across many - so a fragment with no channels is the right
	// answer rather than a gap.
	if channels := channelsOf(t, fragment); len(channels) != 0 {
		t.Errorf("channels: %+v", channels)
	}
	// The shapes are still there, which is the half the strategy does state.
	if got := fieldsOf(t, fragment, "shop.oms.OrderPlaced"); len(got) != 7 {
		t.Errorf("shop.oms.OrderPlaced: %+v", got)
	}
}

func TestTopicRecordStrategySplitsOnTheSchemasOwnName(t *testing.T) {
	// "shop.oms.order-value" under this strategy is topic "shop.oms.order"
	// and record "value" if you split at the hyphen, and neither half is
	// reliable - so the schema's own full name is what the suffix is matched
	// against.
	for _, c := range []struct {
		subject, declared, topic, record string
	}{
		{"orders-com.acme.Order", "com.acme.Order", "orders", "com.acme.Order"},
		{"shop.oms.order-shop.oms.OrderPlaced", "shop.oms.OrderPlaced", "shop.oms.order", "shop.oms.OrderPlaced"},
		{"orders-Order", "", "orders", "Order"},
	} {
		got := resolve(c.subject, c.declared, StrategyTopicRecord)
		if got.Topic != c.topic || got.Record != c.record {
			t.Errorf("%q -> %+v, want topic %q record %q", c.subject, got, c.topic, c.record)
		}
	}
}

func TestTopicStrategyReadsTheSuffix(t *testing.T) {
	for _, c := range []struct {
		subject, declared, topic, record string
		key                              bool
	}{
		{"shop.oms.order-value", "shop.oms.OrderPlaced", "shop.oms.order", "shop.oms.OrderPlaced", false},
		{"shop.oms.order-key", "shop.oms.OrderKey", "shop.oms.order", "shop.oms.OrderKey", true},
		// Registered some other way: it names a shape but cannot name a topic.
		{"loose", "shop.oms.Loose", "", "shop.oms.Loose", false},
	} {
		got := resolve(c.subject, c.declared, StrategyTopic)
		if got.Topic != c.topic || got.Record != c.record || got.Key != c.key {
			t.Errorf("%q -> %+v", c.subject, got)
		}
	}
}

func TestAMissingPathIsReported(t *testing.T) {
	opts := defaults()
	opts.Paths = []string{"vendor/nothing"}

	_, err := extract(plugin.Input{Root: estate}, opts)
	if err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("a path that is not there was walked silently: %v", err)
	}
}

func TestAReferenceNobodyVendoredKeepsItsNameAndLosesItsRef(t *testing.T) {
	// The catalog validates that every field ref resolves, so a ref pointing
	// at a shape this estate does not hold would fail the whole run over a
	// fact that is true: the schema really does reference it, and the shape
	// really does live somewhere else.
	resp, err := extract(
		plugin.Input{Root: "testdata/dangling"},
		Options{Context: "shop", Service: "oms", Paths: []string{"vendor/schemas"}},
	)
	if err != nil {
		t.Fatal(err)
	}

	var fragment catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &fragment); err != nil {
		t.Fatal(err)
	}

	actor := fieldNamed(t, fieldsOf(t, fragment, "shop.oms.AuditWritten"), "actor")
	if actor.Type != "shop.identity.Actor" {
		t.Errorf("the reference lost its name: %+v", actor)
	}
	if actor.Ref != "" {
		t.Errorf("a ref was left pointing at a shape nothing declares: %+v", actor)
	}

	for _, def := range fragment.Defs {
		for _, field := range def.Fields {
			if field.Ref == "" {
				continue
			}
			if _, known := fragment.Defs[field.Ref]; !known {
				t.Errorf("%s refs %s, which the fragment does not declare", field.Name, field.Ref)
			}
		}
	}

	var said bool
	for _, warning := range resp.Warnings() {
		if strings.Contains(warning.Message, "shop.identity.Actor") {
			said = true
		}
	}
	if !said {
		t.Errorf("the unvendored reference was dropped silently: %+v", resp.Warnings())
	}
}
