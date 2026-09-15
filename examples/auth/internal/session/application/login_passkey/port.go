package login_passkey

import (
	"context"
	"errors"
)

// Assertion is what an authenticator signed, as the client hands it over.
type Assertion struct {
	CredentialID string
	Challenge    string
	Signature    string
}

// Verifier is what a passkey login needs from whoever holds the public keys:
// an assertion in, the id of the user whose passkey signed it out.
//
// Declared HERE, by the only code that calls it, so that this package does not
// import the client that satisfies it. The adapter over the webauthn service
// lives in infrastructure and is handed in at assembly.
type Verifier interface {
	// Verify returns the user the assertion belongs to, or ErrRejected. It
	// must not say whether the credential is unknown or the signature wrong.
	Verify(ctx context.Context, assertion Assertion) (userID string, err error)
}

// ErrRejected is the one answer for an assertion that does not check out.
var ErrRejected = errors.New("login_passkey: assertion rejected")
