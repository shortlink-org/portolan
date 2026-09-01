package main

import (
	"path"
	"strings"
)

// Markdown primitives. Small on purpose: a template engine would put the shape
// of a page somewhere other than the code that decides what goes on it.

// table renders a GFM table, or nothing at all when there are no rows. An
// empty table with a header is a heading that promises content and delivers a
// horizontal rule.
func table(headers []string, rows [][]string) string {
	if len(rows) == 0 {
		return ""
	}

	// A column nobody filled in is dropped. The same renderer draws a table of
	// columns with lineage and a table of columns without any, and a column of
	// nine dashes is a question the reader keeps re-asking.
	keep := make([]int, 0, len(headers))
	for i := range headers {
		// The first column identifies the row, so it stays even when empty.
		if i == 0 || anyFilled(rows, i) {
			keep = append(keep, i)
		}
	}

	var b strings.Builder
	head := make([]string, len(keep))
	for i, column := range keep {
		head[i] = headers[column]
	}
	b.WriteString("| " + strings.Join(head, " | ") + " |\n")
	b.WriteString("|" + strings.Repeat(" --- |", len(keep)) + "\n")

	for _, row := range rows {
		cells := make([]string, len(keep))
		for i, column := range keep {
			if column < len(row) {
				cells[i] = cell(row[column])
			} else {
				cells[i] = cell("")
			}
		}
		b.WriteString("| " + strings.Join(cells, " | ") + " |\n")
	}

	return b.String()
}

func anyFilled(rows [][]string, column int) bool {
	for _, row := range rows {
		if column < len(row) && strings.TrimSpace(row[column]) != "" {
			return true
		}
	}

	return false
}

// cell makes a string safe to sit between two pipes. A doc comment routinely
// contains both a newline and a pipe, and either one silently ends the row.
func cell(s string) string {
	s = strings.ReplaceAll(s, "|", "\\|")
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.TrimSpace(s)
	if s == "" {
		return "—"
	}

	return s
}

func code(s string) string {
	if s == "" {
		return ""
	}

	return "`" + s + "`"
}

func fence(lang, body string) string {
	return "```" + lang + "\n" + strings.TrimRight(body, "\n") + "\n```\n"
}

// link is a relative markdown link from one generated page to another. The
// paths are the ones the host will write, so the link is correct wherever the
// docs directory is mounted.
func link(text, from, to string) string {
	return "[" + text + "](" + rel(from, to) + ")"
}

// rel is filepath.Rel for slash paths, between two FILES: the result is
// relative to the directory the first one sits in.
//
// It is written out rather than taken from path/filepath because a plugin
// compiled for wasip1 and one compiled for the host must agree, and
// filepath.Rel agrees with whatever separator it was built for.
func rel(from, to string) string {
	fromDir := strings.Split(path.Dir(from), "/")
	if path.Dir(from) == "." {
		fromDir = nil
	}

	toParts := strings.Split(to, "/")

	common := 0
	for common < len(fromDir) && common < len(toParts)-1 && fromDir[common] == toParts[common] {
		common++
	}

	var out []string
	for range fromDir[common:] {
		out = append(out, "..")
	}
	out = append(out, toParts[common:]...)

	result := strings.Join(out, "/")
	if result == "" {
		return path.Base(to)
	}

	return result
}

// shiftHeadings pushes every ATX heading down by `by` levels, leaving fenced
// code alone.
//
// Readmes and ADR bodies are whole documents that start at `#`. Pasting one
// under a generated `#` gives a page with two top-level headings, which every
// table-of-contents generator then reads as two documents.
func shiftHeadings(md string, by int) string {
	if md == "" {
		return ""
	}

	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	fenced := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			fenced = !fenced

			continue
		}
		if fenced || !strings.HasPrefix(line, "#") {
			continue
		}

		level := 0
		for level < len(line) && line[level] == '#' {
			level++
		}
		// A run of hashes with no space after it is not a heading.
		if level >= len(line) || line[level] != ' ' {
			continue
		}
		// Markdown has no h7. Anything that would go past six stays where it is,
		// because a heading rendered as literal hashes is worse than a deep one.
		if level+by > 6 {
			continue
		}

		lines[i] = strings.Repeat("#", by) + line
	}

	return strings.Join(lines, "\n")
}

// section appends a titled block, and nothing at all when the block is empty.
// Every page here is a list of optional sections, so this is what keeps a
// service with no consumers from growing a "Consumes" heading over a blank.
func section(b *strings.Builder, title, body string) {
	if strings.TrimSpace(body) == "" {
		return
	}

	b.WriteString("\n## " + title + "\n\n")
	b.WriteString(strings.TrimRight(body, "\n") + "\n")
}

func subsection(b *strings.Builder, title, body string) {
	if strings.TrimSpace(body) == "" {
		return
	}

	b.WriteString("\n### " + title + "\n\n")
	b.WriteString(strings.TrimRight(body, "\n") + "\n")
}

// defList renders a page's metadata.
//
// It is a bullet list rather than a two-column table because a table needs a
// header row, and the header over an id and a path is two empty cells that
// every renderer draws a box around.
func defList(rows [][]string) string {
	var b strings.Builder
	for _, row := range rows {
		if len(row) < 2 || strings.TrimSpace(row[1]) == "" {
			continue
		}
		b.WriteString("- **" + row[0] + ":** " + strings.TrimSpace(row[1]) + "\n")
	}

	return b.String()
}

// body prepares a readme or an ADR body to sit under a generated `# Title`.
//
// A document that opens with its own title repeating the page's gets that line
// dropped, and everything below it is already at the right depth. One that
// starts lower is pushed down a level so its sections nest under the page
// instead of beside it.
func body(md, title string) string {
	md = strings.TrimSpace(md)
	if md == "" {
		return ""
	}

	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if heading, ok := strings.CutPrefix(line, "# "); ok && sameTitle(heading, title) {
			return strings.TrimSpace(strings.Join(lines[i+1:], "\n"))
		}

		break
	}

	return shiftHeadings(md, 1)
}

func sameTitle(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}
