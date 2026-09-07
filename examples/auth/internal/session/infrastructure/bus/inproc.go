// Package bus provides typed in-process dispatchers for session events.
package bus

import (
	"github.com/shortlink-org/portolan/examples/auth/internal/platform/messaging"
	domainevent "github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
	integrationevent "github.com/shortlink-org/portolan/examples/auth/internal/session/integration/event"
)

type InProc = messaging.InProc[integrationevent.Event]
type DomainInProc = messaging.InProc[domainevent.Event]

func NewInProc(topic string) *InProc {
	return messaging.NewInProc[integrationevent.Event](topic)
}

func NewDomainInProc(topic string) *DomainInProc {
	return messaging.NewInProc[domainevent.Event](topic)
}
