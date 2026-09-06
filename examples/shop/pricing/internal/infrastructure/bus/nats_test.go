package bus

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

// The adapter against a real server: NATS_URL names it, and without one the
// test is skipped rather than faked. A fake bus would prove nothing about the
// headers the cart and the OMS read.
func TestNATSDeliversByNameAndOnce(t *testing.T) {
	url := os.Getenv("NATS_URL")
	if url == "" {
		t.Skip("NATS_URL is empty")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// A stream of this run's own, so one left by an earlier run holds nothing
	// this one reads.
	run := uuid.NewString()[:8]
	topic := "test." + run + ".thing"
	b, err := ConnectNATS(url, "pricing-test-"+run)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = b.Close()
		name, _ := streamOf(topic)
		_ = b.js.DeleteStream(context.Background(), name)
	})

	received := make(chan Message, 4)
	err = b.Subscribe(ctx, topic, "thing.Happened", func(_ context.Context, m Message) error {
		received <- m

		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	id := uuid.NewString()
	wanted := Message{UUID: id, Topic: topic, Payload: []byte(`{"x":1}`), Metadata: map[string]string{MetadataEventName: "thing.Happened", "traceparent": "00-abc-def-01"}}
	other := Message{UUID: uuid.NewString(), Topic: topic, Payload: []byte(`{}`), Metadata: map[string]string{MetadataEventName: "thing.Other"}}
	for _, m := range []Message{other, wanted, wanted} {
		if err := b.Publish(ctx, m); err != nil {
			t.Fatal(err)
		}
	}

	select {
	case got := <-received:
		if got.UUID != id || got.Topic != topic || string(got.Payload) != `{"x":1}` {
			t.Errorf("got %+v", got)
		}
		// The key as written, not canonicalised: `event_name` is what the
		// other services look for.
		if got.Metadata[MetadataEventName] != "thing.Happened" || got.Metadata["traceparent"] != "00-abc-def-01" {
			t.Errorf("metadata: got %v", got.Metadata)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("nothing arrived")
	}

	// The other name was acknowledged unread, and the repeat of the same id
	// was stored once: nothing else arrives.
	select {
	case got := <-received:
		t.Errorf("a second message arrived: %+v", got)
	case <-time.After(2 * time.Second):
	}
}
