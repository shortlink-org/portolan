package main

// The CODEOWNERS grammar, which is smaller than its reputation.
//
// A line is a path pattern and the handles that own what it matches. Blank
// lines and `#` comments are skipped. Later lines win: the file is read top to
// bottom and the LAST rule that matches a path is the one that owns it, which
// is what lets a broad rule at the top be narrowed underneath.
//
// GitLab adds sections - `[Backend]`, `^[Optional]`, `[Frontend][2]` - and
// under them the last-match rule applies per section rather than per file. It
// is read here as the flatter thing GitHub means, and a file that uses them is
// warned about rather than half-understood in silence, because the difference
// only ever shows up as an owner quietly missing from a page.
//
// Two pieces of gitignore syntax that CODEOWNERS does not have are not
// implemented, on purpose: `!` negation, which no forge supports here, and
// character ranges, which they do but nobody writes.

import (
	"strings"
)

// Rule is one line: what it matches, who owns it, and where it was written.
type Rule struct {
	Pattern string
	Owners  []string
	Line    int
}

// Parsed is a file's rules and what was odd about it.
type Parsed struct {
	Rules []Rule

	// Sections is true when the file uses GitLab's section headers, which
	// change the precedence rule this does not implement.
	Sections bool
}

// parseCodeowners reads the file. It does not fail: a line that is not a rule
// is not a rule, and refusing to describe an estate over a stray word in a
// file the forge itself skips would be a worse answer than the ownership the
// rest of the file states.
func parseCodeowners(src string) Parsed {
	out := Parsed{Rules: []Rule{}}

	for i, raw := range strings.Split(src, "\n") {
		line := strings.TrimSpace(stripComment(raw))
		if line == "" {
			continue
		}
		if isSection(line) {
			out.Sections = true

			continue
		}

		fields := strings.Fields(line)
		// A pattern with no owners is how a forge takes ownership BACK: it
		// matches, and names nobody. Kept as a rule so that it can win over an
		// earlier one, which is the only reason anybody writes it.
		out.Rules = append(out.Rules, Rule{
			Pattern: fields[0],
			Owners:  append([]string(nil), fields[1:]...),
			Line:    i + 1,
		})
	}

	return out
}

// stripComment removes a trailing comment. An escaped `\#` is a literal in a
// path, and paths with a `#` in them exist, so the escape is honoured.
func stripComment(line string) string {
	for i := 0; i < len(line); i++ {
		if line[i] == '#' && (i == 0 || line[i-1] != '\\') {
			return line[:i]
		}
	}

	return line
}

// isSection reports a GitLab section header: `[Name]`, optionally required
// with `^`, optionally with an approval count `[Name][2]`.
func isSection(line string) bool {
	line = strings.TrimPrefix(line, "^")

	return strings.HasPrefix(line, "[") && strings.Contains(line, "]")
}
