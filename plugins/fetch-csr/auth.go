package main

// The only file that reads the environment.
//
// The plugin protocol says a plugin has "no ambient state to read, no
// environment". That is about FACTS: nothing about the estate may come from
// anywhere but the request, or a fragment stops being reproducible from the
// tree it describes.
//
// A credential is not a fact about the estate. It is how the transport is
// allowed to open a socket - it changes whether the fetch succeeds, never what
// the fetch says. Isolating it in one file that nothing else calls is what
// keeps that claim checkable.
//
// It is also why this plugin can never be wasm. It needs a socket and a
// secret, and `process` exists for exactly that trade.

import (
	"encoding/base64"
	"os"
	"strings"
)

// The names Confluent's own tools use, longest first so the specific one wins
// over a shell that exports both.
const (
	KeyEnv    = "CONFLUENT_SCHEMA_REGISTRY_API_KEY"
	SecretEnv = "CONFLUENT_SCHEMA_REGISTRY_API_SECRET"

	// Short aliases, for a self-hosted registry nobody would call Confluent.
	ShortKeyEnv    = "CSR_API_KEY"
	ShortSecretEnv = "CSR_API_SECRET"

	// TokenEnv is a whole Authorization value, for a registry fronted by
	// something that wants a bearer token rather than an API key pair.
	TokenEnv = "CSR_TOKEN"
)

// authorization is the header value to send, or "" for none.
//
// None is a normal outcome, not a failure: a registry inside a private network
// is commonly open to it, and the local one the tests run against certainly is.
func authorization() string {
	if raw := env(TokenEnv); raw != "" {
		// Passed through when it already names its scheme, so the same
		// variable serves "Bearer ..." and an opaque token a proxy expects
		// bare. Guessing on the caller's behalf is how a working token starts
		// failing after somebody adds a prefix.
		if strings.Contains(raw, " ") {
			return raw
		}

		return "Bearer " + raw
	}

	key := first(env(KeyEnv), env(ShortKeyEnv))
	secret := first(env(SecretEnv), env(ShortSecretEnv))
	if key == "" || secret == "" {
		return ""
	}

	return "Basic " + base64.StdEncoding.EncodeToString([]byte(key+":"+secret))
}

func env(name string) string { return strings.TrimSpace(os.Getenv(name)) }

func first(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}

	return ""
}

// OfflineEnv turns the fetch off. Explicit, rather than inferred from a socket
// timeout: CI sets it in one line, and a build that would otherwise depend on
// the registry being up cannot silently start doing so again.
const OfflineEnv = "PORTOLAN_OFFLINE"

func offline() bool {
	if env(OfflineEnv) != "" {
		return true
	}

	// CI verifies what was committed. It never needs to reach the registry, and
	// a fork's pull request has no secret to reach it with.
	switch strings.ToLower(env("CI")) {
	case "", "0", "false":
		return false
	default:
		return true
	}
}
