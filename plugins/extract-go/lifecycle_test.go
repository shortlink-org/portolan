package main

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

const lifecycleSrc = `package session

import "github.com/shortlink-org/go-sdk/fsm"

const (
	StateLive    fsm.State = "live"
	StateRevoked fsm.State = "revoked"
	EventRevoke  fsm.Event = "revoke"
	EventExpire  fsm.Event = "expire"
)

var Rules = fsm.TransitionRuleSet{
	StateLive:    {EventRevoke: StateRevoked, EventExpire: StateExpired},
	StateRevoked: {EventRevive: StateLive},
}

const StateExpired fsm.State = "expired"

type Session struct{ RevokedAt int }

func (s *Session) trigger(ev fsm.Event) bool {
	m := &fsm.FSM{CurrentState: StateLive, TransitionRules: Rules}
	return m.TriggerEvent(nil, ev) == nil
}

func (s *Session) Revoke() (event.SessionEnded, bool) {
	if !s.trigger(EventRevoke) {
		return event.SessionEnded{}, false
	}
	return event.SessionEnded{}, true
}

func (s *Session) Poke(ev fsm.Event) { s.trigger(ev) }

// Two moves, one event: the event is the last move's.
func (s *Session) Bounce() (event.SessionEnded, bool) {
	s.trigger(EventRevive)
	s.trigger(EventRevoke)
	return event.SessionEnded{}, true
}

const EventRevive fsm.Event = "revive"
`

func TestLifecycleIsReadOffTheRuleSetAndTheMover(t *testing.T) {
	p, err := parseSource("session.go", lifecycleSrc)
	if err != nil {
		t.Fatal(err)
	}
	b := &plugin.Builder{}
	events := []catalog.Event{{ID: "auth.auth.session.SessionEnded", Name: "SessionEnded"}}
	lc := readLifecycle(p, "Session", events, "auth.auth.session", b)
	if lc == nil {
		t.Fatal("no lifecycle read")
	}
	// The literal's order, then the state only a target names.
	if got := strings.Join(lc.States, ","); got != "live,revoked,expired" {
		t.Fatalf("states = %s", got)
	}
	if len(lc.Transitions) != 3 {
		t.Fatalf("transitions = %+v", lc.Transitions)
	}
	// In table order: live → revoked twice (Bounce, Revoke), then revoked → live.
	tr := lc.Transitions[1]
	if tr.From != "live" || tr.To != "revoked" || tr.On != "Revoke" || tr.Emits != "auth.auth.session.SessionEnded" || !strings.HasSuffix(tr.Source, "session.go:27") {
		t.Fatalf("transition = %+v", tr)
	}
	// Bounce revives and then revokes: the event it returns is the revoke's.
	if b1 := lc.Transitions[0]; b1.On != "Bounce" || b1.To != "revoked" || b1.Emits == "" {
		t.Fatalf("Bounce's last move = %+v", b1)
	}
	if b0 := lc.Transitions[2]; b0.On != "Bounce" || b0.To != "live" || b0.Emits != "" {
		t.Fatalf("Bounce's first move = %+v", b0)
	}

	var messages []string
	for _, d := range b.Diagnostics {
		messages = append(messages, d.Message)
	}
	joined := strings.Join(messages, "\n")
	// The rule nobody takes, and the method that hands the mover a variable.
	if !strings.Contains(joined, `live → expired on "expire", and no method of Session makes that move`) {
		t.Fatalf("missing the untaken rule: %s", joined)
	}
	if !strings.Contains(joined, "Poke hands trigger something that is not a constant") {
		t.Fatalf("missing the non-constant warning: %s", joined)
	}
}

func TestNoRuleSetMeansNoLifecycle(t *testing.T) {
	p, err := parseSource("user.go", "package user\n\ntype User struct{}\n")
	if err != nil {
		t.Fatal(err)
	}
	if lc := readLifecycle(p, "User", nil, "auth.auth.user", &plugin.Builder{}); lc != nil {
		t.Fatalf("read a lifecycle off nothing: %+v", lc)
	}
}
