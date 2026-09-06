package provider

import (
	"log"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/bus"
)

// ProvideBus fills the bus port: NATS when url names a server, the log when it
// is empty. Which it was is the operator's business, so it is said once.
func ProvideBus(url, name string, out *log.Logger) (bus.Bus, error) {
	if url == "" {
		out.Printf("%s: NATS_URL is empty; events go to the log and none arrive", name)

		return bus.NewLog(out), nil
	}

	return bus.ConnectNATS(url, name)
}
