// Package plugin is the wire contract between the host and a generator.
//
// One JSON message in, one JSON message out, and the same shape whichever
// direction the generator runs in: an extractor reads source and answers with
// a catalog fragment, a renderer reads the catalog and answers with pages.
// Both name files; neither writes them. The host does that, which is what lets
// a generator run as a wasm module with nothing preopened at all.
package plugin

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/shortlink-org/portolan/catalog"
)

const Version = "0.1.0"

// Request is everything a plugin is allowed to know. There is no ambient state
// to read, no environment, and - for a wasm plugin - no filesystem either.
type Request struct {
	PortolanVersion string `json:"portolanVersion"`

	// Kind is what the host is asking for. Empty - the only thing anyone sent
	// before this field existed - means do the work. KindDescribe means answer
	// with a Descriptor and read nothing: it is how the manifest schema is
	// built, and it has to be cheap enough to run over every declared plugin.
	Kind string `json:"kind,omitempty"`

	// Catalog is the merged catalog, for a plugin that renders from it. An
	// extractor is handed the zero value: it runs before there is one.
	Catalog catalog.Catalog `json:"catalog"`

	// Input is where a plugin that reads source should look. Empty for a
	// renderer, which has no business touching the tree.
	Input Input `json:"input"`

	// Options belong to the plugin and are passed through from the manifest
	// unread, so the host never has to know what any plugin can be told.
	Options json.RawMessage `json:"options"`
}

type Input struct {
	// Root is the directory to read, relative to the repository.
	Root string `json:"root"`

	// Commit and GeneratedAt stamp the fragment. The host works them out - the
	// last commit that touched Root, and its date - rather than the plugin
	// reading a clock, because a fragment that changes on every run cannot be
	// committed and cannot be checked. Stamped this way it changes exactly when
	// the source it describes changes.
	Commit      string `json:"commit"`
	GeneratedAt string `json:"generatedAt"`
}

// Response is what comes back.
//
// Files are named, not written. The host rejects a name that climbs out of the
// output directory, and that rejection is the whole of a plugin's authority
// over the tree.
type Response struct {
	Files    []File `json:"files"`
	warnings []Warning

	// Describe answers KindDescribe and is absent otherwise. A plugin written
	// against an older version of this protocol answers without it, which the
	// host reports rather than treating as a plugin with no options.
	Describe *Descriptor `json:"describe,omitempty"`
}

type File struct {
	Name     string `json:"name"`
	Contents string `json:"contents"`
}

// Warning is an in-process extraction note. It is intentionally not serialized
// into Response: the wire contract has one decisive outcome, files or error.
type Warning struct {
	Severity string `json:"severity"` // "warning" | "error"
	Message  string `json:"message"`
	Ref      string `json:"ref,omitempty"`
}

// Builder accumulates a response. Every plugin needs exactly this and nothing
// more, so it lives here rather than being written twice.
type Builder struct {
	Files    []File
	Warnings []Warning
}

func (b *Builder) File(name, contents string) {
	b.Files = append(b.Files, File{Name: name, Contents: contents})
}

func (b *Builder) Warn(ref, message string) {
	b.Warnings = append(b.Warnings, Warning{Severity: "warning", Message: message, Ref: ref})
	where := ""
	if ref != "" {
		where = ref + ": "
	}
	fmt.Fprintln(os.Stderr, "warning:", where+message)
}

func (b *Builder) Response() Response {
	return Response{Files: b.Files, warnings: b.Warnings}
}

// Warnings exposes extraction notes to in-process tests and embedders. They
// are deliberately absent from the JSON protocol: a caller's result is files
// or an error, not files plus an advisory property nobody is required to act on.
func (r Response) Warnings() []Warning { return r.warnings }
