package main

import "testing"

// The rule the whole plugin turns on: a pattern owns a directory when it names
// the directory or anything above it, and does not when it names only
// something inside it.
func TestOwns(t *testing.T) {
	cases := []struct {
		pattern string
		target  string
		want    bool
		why     string
	}{
		{"examples/shop/oms", "examples/shop/oms", true, "the directory itself"},
		{"examples/shop", "examples/shop/oms", true, "a directory above it"},
		{"examples/", "examples/shop/oms", true, "a trailing slash is still a directory"},
		{"/examples", "examples/shop/oms", true, "anchored at the root"},
		{"*", "examples/shop/oms", true, "everything"},
		{"/", "examples/shop/oms", true, "the whole repository"},

		{"examples/shop/oms/internal", "examples/shop/oms", false, "a rule about part of the service is not a rule about the service"},
		{"examples/auth", "examples/shop/oms", false, "a sibling"},
		{"docs", "examples/shop/oms", false, "somewhere else entirely"},

		// Floating patterns match at any depth, which is what gitignore has
		// always meant by a pattern with no slash in it.
		{"oms", "examples/shop/oms", true, "a single segment matches at any depth"},
		{"shop", "examples/shop/oms", true, "including a segment above"},
		{"om", "examples/shop/oms", false, "and matches whole segments, not prefixes"},

		{"examples/*/oms", "examples/shop/oms", true, "a star stays inside its segment"},
		{"examples/*", "examples/shop/oms", true, "and matches the segment above"},
		{"examples/*/oms", "examples/shop/cart/oms", false, "so it does not cross a slash"},
		{"examples/**/oms", "examples/shop/cart/oms", true, "two stars do"},
		{"examples/**", "examples/shop/oms", true, "two stars also match nothing at all"},

		{"", "examples/shop/oms", false, "an empty pattern owns nothing"},
		{"examples", "", false, "and nothing is owned by no pattern"},
	}

	for _, c := range cases {
		if got := owns(c.pattern, c.target); got != c.want {
			t.Errorf("owns(%q, %q) = %v, want %v - %s", c.pattern, c.target, got, c.want, c.why)
		}
	}
}
