package session

import (
	"context"
	"time"

	"github.com/shortlink-org/go-sdk/fsm"
)

// The session's lifecycle, as one table. Two states and one way between
// them: a live session can be revoked, and a revoked one is a record. Expiry
// is not a move - it is what `Live` answers once `now` is past ExpiresAt,
// with no command, no event and nothing running (auth.0003) - so it is not
// in the table either. `trigger` is the only way through the table.
const (
	StateLive    fsm.State = "live"
	StateRevoked fsm.State = "revoked"

	EventRevoke fsm.Event = "revoke"
)

// Rules is where a session can go from where it is.
var Rules = fsm.TransitionRuleSet{
	StateLive:    {EventRevoke: StateRevoked},
	StateRevoked: {},
}

// state reads the session's place in the table off RevokedAt. The state is
// not stored: there is one fact, the timestamp, and no second copy to drift.
func (s *Session) state() fsm.State {
	if !s.RevokedAt.IsZero() {
		return StateRevoked
	}

	return StateLive
}

// trigger runs one event through the table from where the session is, and
// says whether the table allowed it. The machine is built for the call and
// dropped: an aggregate is one thread and one row, and a machine kept on it
// would be one more thing to persist and to clone.
func (s *Session) trigger(ev fsm.Event, now time.Time) bool {
	machine := &fsm.FSM{CurrentState: s.state(), TransitionRules: Rules}
	if err := machine.TriggerEvent(context.Background(), ev); err != nil {
		return false
	}
	if machine.GetCurrentState() == StateRevoked {
		s.RevokedAt = now
	}

	return true
}
