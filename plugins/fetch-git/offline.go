package main

// The only file that reads the environment, and it reads two switches.
//
// The plugin protocol says a plugin has no ambient state to read. That rule is
// about facts: nothing about the estate may come from anywhere but the
// request. Whether to open a socket is not a fact about the estate; it decides
// whether the fetch happens, never what the fetch says, and a test asserts the
// output is byte-identical either way.
//
// What git needs to reach a private forge - a credential helper, a netrc
// entry, an ssh agent - is git's own configuration, and this plugin neither
// reads nor passes any of it. That is also why it can never be wasm: it needs
// a subprocess and a socket.

import (
	"os"
	"strings"
)

// OfflineEnv turns the fetch off. Explicit, rather than inferred from a socket
// timeout: CI sets it in one line, and a build that would otherwise depend on
// the forge being up cannot silently start doing so again.
const OfflineEnv = "PORTOLAN_OFFLINE"

func offline() bool {
	if strings.TrimSpace(os.Getenv(OfflineEnv)) != "" {
		return true
	}

	// CI verifies what was committed. It never needs to reach the forge, and a
	// fork's pull request has no credential to reach it with.
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CI"))) {
	case "", "0", "false":
		return false
	default:
		return true
	}
}
