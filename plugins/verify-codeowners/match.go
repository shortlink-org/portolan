package main

// Whether a rule owns a directory.
//
// CODEOWNERS patterns are gitignore patterns, and the question asked here is
// narrower than the one gitignore answers: not "does this pattern match this
// file" but "does this pattern own this SERVICE", where a service is a
// directory. A rule owns a directory when it matches the directory itself or
// anything above it - `services/` owns `services/oms` - and does not when it
// matches only something inside it: `services/oms/internal` is a rule about
// part of the service, and reading it as ownership of the whole would hand a
// team a page they never asked for.
//
// The two shapes a pattern comes in are the whole of the rule:
//
//   - anchored, when it has a `/` anywhere but the end - `services/oms`,
//     `/docs` - and is matched against the path from the repository root;
//   - floating, when it is a single segment - `*.go`, `internal` - and matches
//     that segment at any depth, which is how gitignore has always read one.
//
// `*` and `?` stay inside a segment, `**` spans any number of them.

import (
	"path"
	"strings"
)

// owns reports whether pattern owns the directory at target, both written
// repository-relative and with forward slashes.
func owns(pattern, target string) bool {
	pattern = strings.TrimSpace(pattern)
	target = strings.Trim(target, "/")
	if pattern == "" || target == "" {
		return false
	}

	// A pattern that is only a `/*` or `*` owns everything at that level.
	anchored := strings.HasPrefix(pattern, "/") || strings.Contains(strings.TrimSuffix(pattern, "/"), "/")
	pattern = strings.Trim(pattern, "/")
	if pattern == "" {
		return true // "/" - the whole repository.
	}

	segments := strings.Split(target, "/")
	if !anchored {
		// Any segment matching means the directory it names is owned, and so
		// is everything under it - including this one.
		for _, segment := range segments {
			if ok, _ := path.Match(pattern, segment); ok {
				return true
			}
		}

		return false
	}

	return matchPrefix(strings.Split(pattern, "/"), segments)
}

// matchPrefix reports whether the pattern matches the target or a prefix of
// it. A pattern longer than the target names something inside the directory
// and owns no more of it than that.
func matchPrefix(pattern, target []string) bool {
	if len(pattern) == 0 {
		return true // Every segment of the pattern matched; the rest is inside it.
	}
	if pattern[0] == "**" {
		// Zero or more segments: try here, then one deeper.
		for i := 0; i <= len(target); i++ {
			if matchPrefix(pattern[1:], target[i:]) {
				return true
			}
		}

		return false
	}
	if len(target) == 0 {
		return false
	}
	if ok, _ := path.Match(pattern[0], target[0]); !ok {
		return false
	}

	return matchPrefix(pattern[1:], target[1:])
}
