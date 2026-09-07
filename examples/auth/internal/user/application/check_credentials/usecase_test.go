package check_credentials_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	userapplication "github.com/shortlink-org/portolan/examples/auth/internal/user/application"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/check_credentials"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/check_credentials/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
)

const (
	address   = "ada@example.com"
	plaintext = "Passw0rdish"
)

func credentialUser(t testing.TB) *user.User {
	t.Helper()
	hash, err := password.ParseHash("test$1$01$02")
	if err != nil {
		t.Fatal(err)
	}
	u, _, err := user.Register("u1", address, hash, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func useCase(t *testing.T, configure func(*MockRepository, *MockLockout, *MockPasswordVerifier)) *check_credentials.UseCase {
	t.Helper()
	repository := NewMockRepository(t)
	lockout := NewMockLockout(t)
	verifier := NewMockPasswordVerifier(t)
	configure(repository, lockout, verifier)
	return check_credentials.New(repository, lockout, verifier)
}

func TestCheckCredentials(t *testing.T) {
	u := credentialUser(t)
	uc := useCase(t, func(repository *MockRepository, lockout *MockLockout, verifier *MockPasswordVerifier) {
		repository.EXPECT().ByEmail(mock.Anything, address).Return(u, nil).Once()
		lockout.EXPECT().Allowed(mock.Anything, "u1").Return(true, nil).Once()
		verifier.EXPECT().Verify(plaintext, u.Password).Return(true).Once()
		lockout.EXPECT().Succeeded(mock.Anything, "u1").Return(nil).Once()
	})

	out, err := uc.Handle(context.Background(), dto.Input{Email: "  ADA@Example.com ", Password: plaintext})
	if err != nil {
		t.Fatal(err)
	}
	if out.UserID != "u1" {
		t.Errorf("userID = %q, want u1", out.UserID)
	}
}

func TestEveryFailureLooksTheSame(t *testing.T) {
	u := credentialUser(t)
	cases := map[string]struct {
		in        dto.Input
		configure func(*MockRepository, *MockLockout, *MockPasswordVerifier)
	}{
		"malformed address": {dto.Input{Email: "nope", Password: plaintext}, func(*MockRepository, *MockLockout, *MockPasswordVerifier) {}},
		"unknown address": {dto.Input{Email: "nobody@example.com", Password: plaintext}, func(r *MockRepository, _ *MockLockout, _ *MockPasswordVerifier) {
			r.EXPECT().ByEmail(mock.Anything, "nobody@example.com").Return(nil, user.ErrNotFound).Once()
		}},
		"locked account": {dto.Input{Email: address, Password: plaintext}, func(r *MockRepository, l *MockLockout, _ *MockPasswordVerifier) {
			r.EXPECT().ByEmail(mock.Anything, address).Return(u, nil).Once()
			l.EXPECT().Allowed(mock.Anything, "u1").Return(false, nil).Once()
		}},
		"wrong password": {dto.Input{Email: address, Password: "Wr0ngGuess"}, func(r *MockRepository, l *MockLockout, v *MockPasswordVerifier) {
			r.EXPECT().ByEmail(mock.Anything, address).Return(u, nil).Once()
			l.EXPECT().Allowed(mock.Anything, "u1").Return(true, nil).Once()
			v.EXPECT().Verify("Wr0ngGuess", u.Password).Return(false).Once()
			l.EXPECT().Failed(mock.Anything, "u1").Return(nil).Once()
		}},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			out, err := useCase(t, tc.configure).Handle(context.Background(), tc.in)
			if !errors.Is(err, userapplication.ErrInvalidCredentials) || err.Error() != userapplication.ErrInvalidCredentials.Error() {
				t.Fatalf("= %v, want the plain credential refusal", err)
			}
			if out.UserID != "" {
				t.Errorf("a failure returned user id %q", out.UserID)
			}
		})
	}
}

func TestAnUnreachableLockoutStopsTheCheck(t *testing.T) {
	u := credentialUser(t)
	down := errors.New("lockout store is down")
	uc := useCase(t, func(repository *MockRepository, lockout *MockLockout, _ *MockPasswordVerifier) {
		repository.EXPECT().ByEmail(mock.Anything, address).Return(u, nil).Once()
		lockout.EXPECT().Allowed(mock.Anything, "u1").Return(false, down).Once()
	})

	_, err := uc.Handle(context.Background(), dto.Input{Email: address, Password: plaintext})
	if !errors.Is(err, down) {
		t.Fatalf("= %v, want the store's error", err)
	}
}

func TestPolicyIsNotAppliedOnTheWayIn(t *testing.T) {
	u := credentialUser(t)
	uc := useCase(t, func(repository *MockRepository, lockout *MockLockout, verifier *MockPasswordVerifier) {
		repository.EXPECT().ByEmail(mock.Anything, address).Return(u, nil).Once()
		lockout.EXPECT().Allowed(mock.Anything, "u1").Return(true, nil).Once()
		verifier.EXPECT().Verify("abc", u.Password).Return(false).Once()
		lockout.EXPECT().Failed(mock.Anything, "u1").Return(nil).Once()
	})

	_, err := uc.Handle(context.Background(), dto.Input{Email: address, Password: "abc"})
	if !errors.Is(err, userapplication.ErrInvalidCredentials) {
		t.Fatalf("= %v, want the plain credential refusal", err)
	}
}
