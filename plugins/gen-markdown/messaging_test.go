package genmarkdown

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestMessagingIndexReconcilesSubscribersWithDomainEventWires(t *testing.T) {
	cat := fixtureCatalog(t)
	svc := &cat.Contexts[0].Services[0]
	svc.Channels = append(svc.Channels, catalog.Channel{
		Address:  "orphan",
		Protocol: "nats",
		Messages: []catalog.ChannelMessage{{Name: "outside.Message", Direction: catalog.ChannelReceive}},
	})

	page := renderedFiles(render(plugin.Request{Catalog: cat}, Options{}))[messagingPage]
	if !strings.Contains(page, "`outside.Message` | receive | `orphan` | nats") || !strings.Contains(page, "| no publisher |") {
		t.Fatalf("subscriber without publisher is not surfaced:\n%s", page)
	}

	event := &cat.Contexts[0].Services[0].Aggregates[0].Events[0]
	event.Wire = &catalog.EventWire{Name: "outside.Message", Channel: "orphan"}
	page = renderedFiles(render(plugin.Request{Catalog: cat}, Options{}))[messagingPage]
	line := "`outside.Message` | receive | `orphan` | nats"
	at := strings.Index(page, line)
	if at < 0 || !strings.Contains(page[at:at+min(len(page)-at, 500)], "| clear |") {
		t.Fatalf("domain event wire did not resolve the publisher:\n%s", page)
	}
}
