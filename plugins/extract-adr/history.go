package extractadr

import (
	"path/filepath"
	"time"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// The markdown says when a decision was taken. Git says when it was written
// down and by whom, and when it was last changed - the other half of "who
// decided this", and one the author never has to type. Read from the file's
// own commits, following renames, so a record moved into docs/adr keeps the
// day it was first committed.
//
// The extractor does not read git itself: it asks for the history in its
// descriptor (plugin.NeedHistory) and the host hands it over in the request
// (portolan.0007), which is what lets this run as a wasm module. It is still
// a function of the checkout: the same commit gives the same answer on every
// machine, which is what lets the fragment be committed and checked.

type history struct {
	// files is what the host read, keyed the way the extractor names a file;
	// nil when the host had no checkout to read, and every record is answered
	// with nothing.
	files map[string]plugin.FileHistory
}

func newHistory(in plugin.Input, mode string, b *plugin.Builder) *history {
	if mode == "none" {
		return &history{}
	}
	if in.History == nil {
		b.Warn(in.Root, "not inside a git checkout, so the records say nothing about who committed them; set `history` to \"none\" to stop hearing this")

		return &history{}
	}

	return &history{files: in.History}
}

// of answers with the commit that first added the file and the one that last
// touched it, or nothing when the file has no history - it is new, or the
// root is not a checkout.
func (h *history) of(file string) (created, revised *catalog.AdrCommit) {
	entry, ok := h.files[filepath.ToSlash(filepath.Clean(file))]
	if !ok {
		return nil, nil
	}
	created = commitOf(entry.Created)
	if entry.Revised != nil && entry.Revised.Commit != entry.Created.Commit {
		revised = commitOf(*entry.Revised)
	}

	return created, revised
}

func commitOf(commit plugin.Commit) *catalog.AdrCommit {
	if commit.Commit == "" {
		return nil
	}

	return &catalog.AdrCommit{Commit: commit.Commit, Author: commit.Author, Date: commit.Date}
}

func decisionDate(created *catalog.AdrCommit) string {
	if created == nil {
		return ""
	}
	if stamp, err := time.Parse(time.RFC3339, created.Date); err == nil {
		return stamp.Format("2006-01-02")
	}
	if day, err := time.Parse("2006-01-02", created.Date); err == nil {
		return day.Format("2006-01-02")
	}
	return ""
}
