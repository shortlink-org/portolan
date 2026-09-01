// Package main is portolan-gen-markdown: a catalog in, a directory of markdown
// out.
//
// The plugin never touches the filesystem. It is handed a catalog on stdin and
// answers with the files it would like written; the host writes them. That is
// what lets the same binary run as a sandboxed wasm module with no directory
// preopened at all, and it is what makes `--check` cheap: the host compares
// what came back against what is on disk without the plugin knowing there is a
// disk.
package main

import (
	"fmt"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are this plugin's own settings, passed through from the manifest.
type Options struct {
	// Title heads the index page. The catalog does not name the estate, so
	// this is the one thing the plugin cannot derive.
	Title string `json:"title,omitempty"`
}

// builder is plugin.Builder with the formatting the render code wants. The
// shared one deliberately takes a plain string: a protocol type that knows
// about printf verbs is a protocol type doing somebody else's job.
type builder struct {
	plugin.Builder
}

func (b *builder) file(name, contents string) { b.File(name, contents) }

func (b *builder) warn(ref, format string, args ...any) {
	b.Warn(ref, fmt.Sprintf(format, args...))
}
