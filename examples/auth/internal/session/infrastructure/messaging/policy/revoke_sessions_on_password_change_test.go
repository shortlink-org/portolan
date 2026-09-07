package policy_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/end_after_credential_change"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/messaging/policy"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/user/integration/event"
)

var change = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func TestPasswordChangeDelegatesToTheSessionApplication(t *testing.T) {
	ender := NewMockSessionEnder(t)
	ender.EXPECT().Handle(mock.Anything, end_after_credential_change.Command{
		UserID:    "u1",
		ChangedAt: change,
		Keep:      "laptop",
	}).Return(nil).Once()

	err := policy.New(ender).Handle(context.Background(), userevent.NewPasswordChanged("u1", "laptop", change))
	if err != nil {
		t.Fatal(err)
	}
}

func TestAdministrativeResetSparesNothing(t *testing.T) {
	ender := NewMockSessionEnder(t)
	ender.EXPECT().Handle(mock.Anything, end_after_credential_change.Command{UserID: "u1", ChangedAt: change}).Return(nil).Once()

	if err := policy.New(ender).Handle(
		context.Background(), userevent.NewPasswordChanged("u1", "", change)); err != nil {
		t.Fatal(err)
	}
}

func TestRedeliveryIsDelegatedAgain(t *testing.T) {
	ender := NewMockSessionEnder(t)
	want := end_after_credential_change.Command{UserID: "u1", ChangedAt: change, Keep: "laptop"}
	ender.EXPECT().Handle(mock.Anything, want).Return(nil).Twice()
	p := policy.New(ender)
	e := userevent.NewPasswordChanged("u1", "laptop", change)

	if err := p.Handle(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	if err := p.Handle(context.Background(), e); err != nil {
		t.Fatal(err)
	}
}

func TestOtherEventsAreIgnored(t *testing.T) {
	ender := NewMockSessionEnder(t)
	if err := policy.New(ender).Handle(
		context.Background(), userevent.NewUserRegistered("u1", "ada@example.com", change)); err != nil {
		t.Fatal(err)
	}
}

func TestSessionApplicationFailureIsReturned(t *testing.T) {
	boom := errors.New("session store is down")
	ender := NewMockSessionEnder(t)
	ender.EXPECT().Handle(mock.Anything, mock.Anything).Return(boom).Once()

	err := policy.New(ender).Handle(context.Background(), userevent.NewPasswordChanged("u1", "", change))
	if !errors.Is(err, boom) {
		t.Fatalf("= %v, want %v", err, boom)
	}
}
