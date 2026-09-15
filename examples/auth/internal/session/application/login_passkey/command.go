package login_passkey

import "time"

// Command carries a passkey assertion a client wants a session for. The three
// strings are opaque here: only the verifier knows what makes them valid.
type Command struct {
	CredentialID string
	Challenge    string
	Signature    string
}

// Result contains the newly issued session credential, the same as a password
// login answers with.
type Result struct {
	Token     string
	ExpiresAt time.Time
}
