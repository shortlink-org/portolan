// Package bus provides typed in-process dispatchers for user events.
package bus

import (
	"github.com/shortlink-org/portolan/examples/auth/internal/platform/messaging"
	domainevent "github.com/shortlink-org/portolan/examples/auth/internal/user/domain/event"
	integrationevent "github.com/shortlink-org/portolan/examples/auth/internal/user/integration/event"
)

type InProc = messaging.InProc[integrationevent.Event]
type DomainInProc = messaging.InProc[domainevent.Event]

func NewInProc(topic string) *InProc {
	return messaging.NewInProc[integrationevent.Event](topic)
}

// NewDomainInProc replaces the durable publisher in focused application tests.
func NewDomainInProc(topic string) *DomainInProc {
	return messaging.NewInProc[domainevent.Event](topic)
}
