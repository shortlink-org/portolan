package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func run3(t *testing.T, root string, opts Options) plugin.Response {
	t.Helper()

	resp, err := extract(
		plugin.Input{Root: root, Commit: "abc1234", GeneratedAt: "2026-01-01T00:00:00Z"},
		opts,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Files) != 1 {
		t.Fatalf("expected one fragment, got %d files", len(resp.Files))
	}

	return resp
}

func channelsOf(t *testing.T, resp plugin.Response) []catalog.Channel {
	t.Helper()

	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}

	return out.Contexts[0].Services[0].Channels
}

func byAddress(channels []catalog.Channel, address string) *catalog.Channel {
	for i := range channels {
		if channels[i].Address == address {
			return &channels[i]
		}
	}

	return nil
}

func spell(messages []catalog.ChannelMessage) []string {
	out := make([]string, 0, len(messages))
	for _, m := range messages {
		out = append(out, string(m.Direction)+" "+m.Name)
	}

	return out
}

// An operation that names no message carries everything the channel declares,
// which is how a document says "this whole channel goes one way".
func TestSendTakesTheWholeChannel(t *testing.T) {
	channels := channelsOf(t, run3(t, "testdata/v3", Options{Context: "shop", Service: "cart"}))

	basket := byAddress(channels, "shop.cart.basket")
	if basket == nil {
		t.Fatalf("no basket channel in %v", channels)
	}

	want := "send cart.BasketCreated,send cart.BasketCheckedOut"
	if got := strings.Join(spell(basket.Messages), ","); got != want {
		t.Errorf("messages = %s, want %s", got, want)
	}
}

// The address is the channel's own when it names one, not the key it is filed
// under: the key is the document's word, the address is the broker's, and an
// event's wire is compared against the second.
func TestAddressBeatsTheKey(t *testing.T) {
	channels := channelsOf(t, run3(t, "testdata/v3", Options{Context: "shop", Service: "cart"}))

	if byAddress(channels, "basket") != nil {
		t.Error("the channel key was taken for an address")
	}
}

// What the service listens for is the half no publisher's source could say.
func TestReceiveIsReadFromTheOperation(t *testing.T) {
	channels := channelsOf(t, run3(t, "testdata/v3", Options{Context: "shop", Service: "cart"}))

	sessions := byAddress(channels, "auth_session")
	if sessions == nil {
		t.Fatalf("no session channel in %v", channels)
	}

	if got := strings.Join(spell(sessions.Messages), ","); got != "receive auth.SessionEnded" {
		t.Errorf("messages = %s", got)
	}
}

// The name on the wire and the prose beside it, so a reader does not have to
// open the document to know what arrived.
func TestMessageCarriesItsNameAndSummary(t *testing.T) {
	channels := channelsOf(t, run3(t, "testdata/v3", Options{Context: "shop", Service: "cart"}))

	basket := byAddress(channels, "shop.cart.basket")
	created := basket.Messages[0]

	if created.Name != "cart.BasketCreated" {
		t.Errorf("name = %q", created.Name)
	}
	if created.Title != "Basket created" {
		t.Errorf("title = %q", created.Title)
	}
	if created.Doc != "A shopper has a basket." {
		t.Errorf("doc = %q", created.Doc)
	}
}

// A channel nothing operates on is still a channel - the address is a fact -
// but which way it travels is not known, and silence about that is what the
// diagnostic is for.
func TestChannelWithNoOperationIsReportedNotDropped(t *testing.T) {
	resp := run3(t, "testdata/v3", Options{Context: "shop", Service: "cart"})

	telemetry := byAddress(channelsOf(t, resp), "shop.cart.telemetry")
	if telemetry == nil {
		t.Fatal("a channel with no operation was dropped")
	}
	if len(telemetry.Messages) != 0 {
		t.Errorf("messages = %v", telemetry.Messages)
	}

	var said bool
	for _, d := range resp.Warnings() {
		if strings.Contains(d.Message, "shop.cart.telemetry") {
			said = true
		}
	}
	if !said {
		t.Errorf("nothing was said about it: %v", resp.Warnings())
	}
}

// 2.x names its operations from the client's side: `subscribe` is what the
// application produces and `publish` is what it consumes. Reading them the
// obvious way gets every arrow backwards.
func TestVersionTwoOperationsAreReadFromTheApplicationsSide(t *testing.T) {
	channels := channelsOf(t, run3(t, "testdata/v2", Options{Context: "shop", Service: "billing"}))

	raised := byAddress(channels, "billing_invoice")
	if raised == nil {
		t.Fatalf("no invoice channel in %v", channels)
	}
	want := "send billing.InvoiceRaised,send billing.InvoiceSettled"
	if got := strings.Join(spell(raised.Messages), ","); got != want {
		t.Errorf("subscribe means the application sends; got %s", got)
	}

	consumed := byAddress(channels, "auth_user")
	if consumed == nil {
		t.Fatalf("no auth_user channel in %v", channels)
	}
	if got := strings.Join(spell(consumed.Messages), ","); got != "receive auth.UserRegistered" {
		t.Errorf("publish means the application receives; got %s", got)
	}
}

// The fragment describes what the service says on the bus and nothing else.
func TestFragmentClaimsNothingItDoesNotKnow(t *testing.T) {
	var out catalog.Catalog
	resp := run3(t, "testdata/v3", Options{Context: "shop", Service: "cart"})
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}

	service := out.Contexts[0].Services[0]
	if service.Name != "" || service.Readme != "" || service.Repo != "" {
		t.Errorf("the bus fragment should not name the service: %+v", service)
	}
	if len(service.Aggregates) != 0 || len(service.Provides) != 0 {
		t.Error("the bus fragment should carry no aggregates and no interfaces")
	}
}

// The fragment's name is the manifest's to choose, and `bus.json` when it does
// not.
func TestFragmentName(t *testing.T) {
	resp := run3(t, "testdata/v3", Options{Context: "shop", Service: "cart"})
	if resp.Files[0].Name != "bus.json" {
		t.Errorf("name = %q", resp.Files[0].Name)
	}

	resp = run3(t, "testdata/v3", Options{Context: "shop", Service: "cart", Out: "channels.json"})
	if resp.Files[0].Name != "channels.json" {
		t.Errorf("name = %q", resp.Files[0].Name)
	}
}
