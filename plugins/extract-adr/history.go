package main

import (
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// The markdown says when a decision was taken. Git says when it was written
// down and by whom, and when it was last changed - the other half of "who
// decided this", and one the author never has to type. Read from the file's
// own commits, following renames, so a record moved into docs/adr keeps the
// day it was first committed.
//
// This is the one place an extractor reads history rather than the tree. It
// is still a function of the checkout: the same commit gives the same answer
// on every machine, which is what lets the fragment be committed and checked.

type history struct {
	root string
	// repo is the working tree the root belongs to, or "" when there is none
	// and every record is answered with nothing.
	repo string
}

func newHistory(root, mode string, b *plugin.Builder) *history {
	h := &history{root: root}
	if mode == "none" {
		return h
	}

	top, err := git(root, "rev-parse", "--show-toplevel")
	if err != nil || top == "" {
		b.Warn(root, "not inside a git checkout, so the records say nothing about who committed them; set `history` to \"none\" to stop hearing this")

		return h
	}
	h.repo = top

	return h
}

// of answers with the commit that first added the file and the one that last
// touched it, or nothing when the file has no history - it is new, or the
// root is not a checkout.
func (h *history) of(file string) (created, revised *catalog.AdrCommit) {
	if h.repo == "" {
		return nil, nil
	}

	// The file is named from where the extractor runs; git is asked from the
	// top of the checkout, so the path is made absolute rather than left to
	// be read against a directory it was not written for.
	abs, err := filepath.Abs(file)
	if err != nil {
		return nil, nil
	}
	out, err := git(h.repo, "log", "--follow", "--format=%H%x1f%an%x1f%cI", "--", abs)
	if err != nil || out == "" {
		return nil, nil
	}

	lines := strings.Split(out, "\n")
	first := commitOf(lines[len(lines)-1])
	last := commitOf(lines[0])
	if first == nil {
		return nil, nil
	}
	if last != nil && last.Commit != first.Commit {
		return first, last
	}

	return first, nil
}

func commitOf(line string) *catalog.AdrCommit {
	parts := strings.Split(line, "\x1f")
	if len(parts) != 3 || parts[0] == "" {
		return nil
	}

	return &catalog.AdrCommit{Commit: parts[0], Author: parts[1], Date: parts[2]}
}

// git runs one command in the directory and answers with its trimmed output.
// Its stderr is not this run's diagnostics: a directory that is not a
// checkout is a fact newHistory reports once, in its own words.
func git(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", filepath.Clean(dir)}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(out)), nil
}
