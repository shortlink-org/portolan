package login

import (
	"context"
	"errors"
)

// ErrBlocked is the answer when the risk service refuses the attempt. It is
// returned after the account's sessions have been ended, never before: a
// caller that sees it knows the account has already been locked down.
var ErrBlocked = errors.New("login: attempt blocked")

// Attempt is what the risk service is told about a login it is asked to judge.
// The credentials are not in it - they have been checked by the time risk is
// asked, and risk decides whether that is enough today, not whether they were
// right.
type Attempt struct {
	UserID string
}

// Verdict is closed: a login switches on it, and a new value is a change to
// this package rather than a string somebody starts returning.
type Verdict string

const (
	VerdictAllow Verdict = "allow"
	VerdictBlock Verdict = "block"
)

// Risk is what login needs from a risk service, stated as the smallest
// interface that says it. Declared HERE, like Authenticator, so that this
// package does not import the client that satisfies it; the adapter over the
// generated gRPC client lives in infrastructure and is handed in at assembly.
type Risk interface {
	// Assess judges the attempt. An error is the service being unreachable or
	// wrong, not a verdict, and login treats it as a refusal to issue.
	Assess(ctx context.Context, attempt Attempt) (Verdict, error)
}
