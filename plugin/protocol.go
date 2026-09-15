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
	"path"
	"path/filepath"
	"strings"

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

	// Output is the directory where the host will place the files returned by
	// this plugin, relative to the repository. Extractors use it only when a
	// catalog entry needs to point at a generated companion document.
	Output string `json:"output,omitempty"`

	// Repository is where the repository Root belongs to begins, relative to
	// the workspace like Root: the directory a fetched copy was written to,
	// when Root lies inside one. Empty when the workspace is the repository,
	// which is every monorepo service and every host that does not say.
	//
	// The catalog spells a path from the repository the file lives in, since
	// that is what a source link opens on the forge. Root alone cannot tell a
	// plugin that: `vendor/repos/acme/shop` is a directory of this checkout
	// and nothing upstream, while `examples/shop/oms` is a directory of both.
	// RepositoryPath turns one into the other.
	Repository string `json:"repository,omitempty"`

	// Provenance is not part of the request (portolan.0010). A fragment used
	// to carry a commit and a date that the host worked out from the last
	// commit touching Root and every plugin copied to the top of its output.
	// The host now reads both from the git history of the fragment it wrote,
	// so a plugin has nothing to stamp and no clock to read: its output
	// changes exactly when the source it describes changes, and when that was
	// is a fact about the file, not a field in it.

	// History is when each file under Root was first committed and last
	// changed, keyed by the file's path as the plugin would name it - the same
	// relative form as Root. Present only for a plugin whose descriptor asks
	// (NeedHistory) and only when Root lies inside a git checkout; a plugin
	// that asked and finds nil knows there was no history to read. The host
	// reads it (portolan.0007) so that no plugin has to run git, which a wasm
	// module cannot.
	History map[string]FileHistory `json:"history,omitempty"`
}

// RepositoryPath spells a path of the workspace, written the way Root is, from
// the repository it lies in: with Repository `vendor/repos/acme/shop`, the
// path `vendor/repos/acme/shop/services/oms` is `services/oms`, and the
// repository's own directory is "" - the whole of it. With no Repository, or
// for a path outside it, the path comes back as given, slashes forward.
func (in Input) RepositoryPath(p string) string {
	p = filepath.ToSlash(p)
	repo := strings.Trim(path.Clean(filepath.ToSlash(in.Repository)), "/")
	if repo == "" || repo == "." {
		return p
	}
	clean := path.Clean(p)
	if clean == repo {
		return ""
	}
	if rest, ok := strings.CutPrefix(clean, repo+"/"); ok {
		return rest
	}
	return p
}

// RepositorySource is RepositoryPath for a source as the catalog writes one,
// a path with or without a `:line` after it.
func (in Input) RepositorySource(where string) string {
	if at := strings.LastIndexByte(where, ':'); at > 0 && at < len(where)-1 && strings.Trim(where[at+1:], "0123456789") == "" {
		return in.RepositoryPath(where[:at]) + where[at:]
	}
	return in.RepositoryPath(where)
}

// RootPath is RepositoryPath for a path a plugin found under Root and spelled
// from Root: `internal/di/app.go` under `examples/shop/pricing` is
// `examples/shop/pricing/internal/di/app.go` in a monorepo and
// `internal/di/app.go` in a fetched copy rooted there. An absolute Root - a
// test's temporary directory, never the host's request - names no place in a
// workspace, and the path stays spelled from Root.
func (in Input) RootPath(rel string) string {
	rel = filepath.ToSlash(rel)
	if in.Root == "" || filepath.IsAbs(in.Root) || path.IsAbs(rel) || filepath.IsAbs(rel) {
		return rel
	}
	return in.RepositoryPath(path.Join(filepath.ToSlash(in.Root), rel))
}

// RootSource is RootPath for a source with or without a `:line` after it.
func (in Input) RootSource(where string) string {
	if at := strings.LastIndexByte(where, ':'); at > 0 && at < len(where)-1 && strings.Trim(where[at+1:], "0123456789") == "" {
		return in.RootPath(where[:at]) + where[at:]
	}
	return in.RootPath(where)
}

// FileHistory is one file's first and last commit. Revised is nil when the
// file has one commit.
type FileHistory struct {
	Created Commit  `json:"created"`
	Revised *Commit `json:"revised,omitempty"`
}

// Commit is one commit as the host read it: full sha, author name, and the
// committer date in strict ISO 8601.
type Commit struct {
	Commit string `json:"commit"`
	Author string `json:"author"`
	Date   string `json:"date"`
}

// Response is what comes back.
//
// Files are named, not written (portolan.0001). The host rejects a name that climbs out of the
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
