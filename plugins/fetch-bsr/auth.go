package main

// The only file that reads the environment.
//
// The plugin protocol says a plugin has "no ambient state to read, no
// environment". That is about FACTS: nothing about the estate may come from
// anywhere but the request, or a fragment stops being reproducible from the
// tree it describes.
//
// A credential is not a fact about the estate. It is how the transport is
// allowed to open a socket, the same way a git credential is - it changes
// whether the fetch succeeds, never what the fetch says. Isolating it in one
// file that nothing else calls is what keeps that claim checkable.
//
// It is also why this plugin can never be wasm. It needs a socket and a
// secret, and `process` exists for exactly that trade.

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// TokenEnv is where `buf registry login` is usually mirrored in CI.
const TokenEnv = "BUF_TOKEN"

// token finds a credential for a registry, or returns none.
//
// None is a normal outcome, not a failure: public modules download
// anonymously, and an estate whose schemas are public never needs a token.
func token(registry string) string {
	if t := strings.TrimSpace(os.Getenv(TokenEnv)); t != "" {
		return t
	}

	return netrcToken(registry)
}

// netrcToken reads the password `buf registry login` wrote.
func netrcToken(registry string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	for _, name := range []string{".netrc", "_netrc"} {
		if t := readNetrc(filepath.Join(home, name), registry); t != "" {
			return t
		}
	}

	return ""
}

// readNetrc walks a netrc for the machine asked about.
//
// Deliberately small: netrc is a stream of words, and the only entry that
// matters here is the password belonging to one machine.
func readNetrc(path, machine string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()

	words := bufio.NewScanner(file)
	words.Split(bufio.ScanWords)

	current := ""
	for words.Scan() {
		switch words.Text() {
		case "machine":
			if !words.Scan() {
				return ""
			}
			current = words.Text()
		case "default":
			current = machine
		case "password":
			if !words.Scan() {
				return ""
			}
			if current == machine {
				return words.Text()
			}
		case "login", "account":
			// Read past the value so it cannot be mistaken for a keyword.
			words.Scan()
		}
	}

	return ""
}

// OfflineEnv turns the fetch off. Explicit, rather than inferred from a socket
// timeout: CI sets it in one line, and a build that would otherwise depend on
// the registry being up cannot silently start doing so again.
const OfflineEnv = "PORTOLAN_OFFLINE"

func offline() bool {
	if strings.TrimSpace(os.Getenv(OfflineEnv)) != "" {
		return true
	}

	// CI verifies what was committed. It never needs to reach the registry, and
	// a fork's pull request has no secret to reach it with.
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CI"))) {
	case "", "0", "false":
		return false
	default:
		return true
	}
}
