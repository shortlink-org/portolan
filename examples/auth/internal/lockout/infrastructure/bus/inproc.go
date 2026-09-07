// Package bus provides typed in-process dispatchers for lockout events.
package bus

import (
	lockoutevent "github.com/shortlink-org/portolan/examples/auth/internal/lockout/domain/event"
	integrationevent "github.com/shortlink-org/portolan/examples/auth/internal/lockout/integration/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/platform/messaging"
)

type InProc = messaging.InProc[integrationevent.Event]
type DomainInProc = messaging.InProc[lockoutevent.Event]

func NewInProc(topic string) *InProc {
	return messaging.NewInProc[integrationevent.Event](topic)
}

func NewDomainInProc(topic string) *DomainInProc {
	return messaging.NewInProc[lockoutevent.Event](topic)
}
