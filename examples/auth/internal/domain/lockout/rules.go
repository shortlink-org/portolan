package lockout

import (
	"context"
	"time"

	"github.com/shortlink-org/go-sdk/fsm"
)

// The lockout's lifecycle, as one table. Open while wrong passwords are being
// counted; locked from the failure that reaches the threshold. A lock that
// has run out is not a state of its own: the account is open to `Locked(now)`
// the moment the time passes, and the table's way back - `lapse` - is taken
// on the next attempt, when the count starts again. `trigger` is the only way
// through the table.
const (
	StateOpen   fsm.State = "open"
	StateLocked fsm.State = "locked"

	EventLock  fsm.Event = "lock"
	EventLapse fsm.Event = "lapse"
)

// Rules is where a lockout can go from where it is.
var Rules = fsm.TransitionRuleSet{
	StateOpen:   {EventLock: StateLocked},
	StateLocked: {EventLapse: StateOpen},
}

// state reads the lockout's place in the table off LockedUntil: a lock that
// was set and not yet cleared is a lock, whether or not its time has passed.
// `Locked(now)` is the other question - is the account refusing logins - and
// the two disagree exactly while a lock has run out and nobody has tried yet.
func (l *Lockout) state() fsm.State {
	if !l.LockedUntil.IsZero() {
		return StateLocked
	}

	return StateOpen
}

// trigger runs one event through the table from where the lockout is, and
// says whether the table allowed it. The machine is built for the call and
// dropped; see session.trigger for why.
func (l *Lockout) trigger(ev fsm.Event, now time.Time) bool {
	machine := &fsm.FSM{CurrentState: l.state(), TransitionRules: Rules}
	if err := machine.TriggerEvent(context.Background(), ev); err != nil {
		return false
	}
	switch machine.GetCurrentState() {
	case StateLocked:
		l.LockedUntil = now.Add(Duration)
	case StateOpen:
		l.LockedUntil = time.Time{}
		l.Failures = 0
	}

	return true
}
