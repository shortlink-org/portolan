package extractrfc

import (
	"path/filepath"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

type history struct{ files map[string]plugin.FileHistory }

func newHistory(in plugin.Input, mode string, b *plugin.Builder) *history {
	if mode == "none" {
		return &history{}
	}
	if in.History == nil {
		b.Warn(in.Root, "not inside a git checkout, so RFC authorship and activity are unavailable; set `history` to \"none\" to stop hearing this")
		return &history{}
	}
	return &history{files: in.History}
}

func (h *history) of(file string) (created, revised *catalog.AdrCommit) {
	entry, ok := h.files[filepath.ToSlash(filepath.Clean(file))]
	if !ok {
		return nil, nil
	}
	created = rfcCommit(entry.Created)
	if entry.Revised != nil && entry.Revised.Commit != entry.Created.Commit {
		revised = rfcCommit(*entry.Revised)
	}
	return created, revised
}

func rfcCommit(commit plugin.Commit) *catalog.AdrCommit {
	if commit.Commit == "" {
		return nil
	}
	return &catalog.AdrCommit{Commit: commit.Commit, Author: commit.Author, Date: commit.Date}
}
