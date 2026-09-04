package lockout_test

import (
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

// fail records n wrong passwords at `at` and returns the last answer.
func fail(l *lockout.Lockout, n int, at time.Time) bool {
	locked := false
	for range n {
		_, locked = l.Fail(at)
	}
	return locked
}

func TestFailuresUnderTheThresholdLockNothing(t *testing.T) {
	l := lockout.New("u1")

	if locked := fail(l, lockout.Threshold-1, now); locked {
		t.Fatal("locked before the threshold")
	}
	if !l.Allows(now) {
		t.Error("an account under the threshold should still be allowed")
	}
	if l.Failures != lockout.Threshold-1 {
		t.Errorf("failures = %d, want %d", l.Failures, lockout.Threshold-1)
	}
}

// The rule this aggregate exists for: the fifth wrong password locks the
// account, and says so.
func TestTheThresholdFailureLocks(t *testing.T) {
	l := lockout.New("u1")
	fail(l, lockout.Threshold-1, now)

	ev, locked := l.Fail(now)
	if !locked {
		t.Fatal("the threshold failure did not lock")
	}
	if l.Allows(now) {
		t.Error("a locked account should not be allowed")
	}
	if want := now.Add(lockout.Duration); !ev.Until().Equal(want) || !l.LockedUntil.Equal(want) {
		t.Errorf("until = %v / %v, want %v", ev.Until(), l.LockedUntil, want)
	}
	if ev.UserID() != "u1" || ev.AggregateID() != "u1" {
		t.Errorf("event = %+v, want it to name the user", ev)
	}
}

// A failure while locked is not a failure that was checked, so it is neither
// counted nor announced.
func TestFailuresWhileLockedCountForNothing(t *testing.T) {
	l := lockout.New("u1")
	fail(l, lockout.Threshold, now)
	before := *l

	_, locked := l.Fail(now.Add(time.Minute))
	if locked {
		t.Error("a failure while locked announced a lock that already existed")
	}
	if *l != before {
		t.Errorf("a failure while locked changed the lockout: %+v -> %+v", before, *l)
	}
}

// The lock running out is time passing, not a transition: nothing announces
// it, and the next wrong password starts a fresh count.
func TestAfterTheLockRunsOutTheCountStartsAgain(t *testing.T) {
	l := lockout.New("u1")
	fail(l, lockout.Threshold, now)
	later := now.Add(lockout.Duration)

	if !l.Allows(later) {
		t.Fatal("the lock should have run out")
	}
	if _, locked := l.Fail(later); locked {
		t.Error("the first failure after a lock locked again")
	}
	if l.Failures != 1 {
		t.Errorf("failures = %d, want the count to start at one", l.Failures)
	}
	if !l.LockedUntil.IsZero() {
		t.Error("a lock that ran out should be cleared once counting resumes")
	}
}

func TestSuccessClearsTheCount(t *testing.T) {
	l := lockout.New("u1")
	fail(l, 3, now)

	if changed := l.Succeed(now); !changed {
		t.Fatal("clearing three failures should be a change")
	}
	if l.Failures != 0 {
		t.Errorf("failures = %d after a success", l.Failures)
	}
	if changed := l.Succeed(now); changed {
		t.Error("a success with nothing to clear reported a change")
	}
}

// A success cannot happen while locked, because the password is refused
// unchecked. Should one be reported anyway, the lock is what stands.
func TestSuccessWhileLockedKeepsTheLock(t *testing.T) {
	l := lockout.New("u1")
	fail(l, lockout.Threshold, now)

	if changed := l.Succeed(now); changed {
		t.Error("a success while locked changed the lockout")
	}
	if l.Allows(now) {
		t.Error("the lock should have stood")
	}
}
