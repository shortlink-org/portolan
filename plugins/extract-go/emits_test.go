package extractgo

import (
	"reflect"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

const emittingDomain = `package lockout

import "example.com/auth/internal/lockout/domain/event"

type Lockout struct{ failures int }

func New(userID string) (*Lockout, event.Created) { return &Lockout{}, event.Created{} }

// Fail hands the event back.
func (l *Lockout) Fail() (event.AccountLocked, bool) { return event.AccountLocked{}, true }

// Succeed records through a helper.
func (l *Lockout) Succeed() { l.record() }

func (l *Lockout) record() { _ = event.Unlocked{} }

// Allows publishes nothing.
func (l *Lockout) Allows() bool { return true }
`

var lockoutEvents = []catalog.Event{
	{ID: "auth.lockout.Created", Name: "Created"},
	{ID: "auth.lockout.AccountLocked", Name: "AccountLocked"},
	{ID: "auth.lockout.Unlocked", Name: "Unlocked"},
}

func TestAUseCaseEmitsWhatTheDomainCallsItMakesProduce(t *testing.T) {
	domain, err := parseSource("lockout.go", emittingDomain)
	if err != nil {
		t.Fatal(err)
	}
	e := domainEmitters(domain, "Lockout", lockoutEvents)

	cases := map[string]struct {
		src  string
		want []string
	}{
		"root method handing an event back": {`package fail
import lockout "example.com/auth/internal/lockout/domain"
func Handle(l *lockout.Lockout) { if l.Allows() { l.Fail() } }`, []string{"auth.lockout.AccountLocked"}},
		"root method recording through a helper": {`package ok
func Handle(l interface{ Succeed() }) { l.Succeed() }`, []string{"auth.lockout.Unlocked"}},
		"domain function through the import, in event order": {`package register
import "example.com/auth/internal/lockout/domain"
func Handle(l interface{ Fail() }) { l.Fail(); lockout.New("u") }`, []string{"auth.lockout.Created", "auth.lockout.AccountLocked"}},
		"a function of another package with the same name": {`package other
import "example.com/other"
func Handle() { other.New() }`, nil},
		"reading only": {`package check
func Handle(l interface{ Allows() bool }) bool { return l.Allows() }`, nil},
	}
	for name, c := range cases {
		useCase, err := parseSource("usecase.go", c.src)
		if err != nil {
			t.Fatal(name, err)
		}
		got := e.useCaseEmits(useCase, "internal/lockout/domain")
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %v, want %v", name, got, c.want)
		}
	}
}
