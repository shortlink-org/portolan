package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"github.com/shortlink-org/portolan/plugins/openapi"
)

// A document in a tree is one of two things, and what sits beside it says
// which. A server generated from it - oapi-codegen's ServerInterface, swag's
// docs package, a handler or controller written against it - means this
// service implements it, and the document is what the service provides. A
// client generated from it means this service calls it: a document vendored
// beside a client describes a system this tree does not implement, which is
// a system outside the estate unless the manifest says the api is one of
// ours. A document with neither beside it is reported and left alone, because
// reading it as either would be a guess.

// Directories nobody's documents live in: dependencies, build output, and the
// fixtures of tests.
var skippedDirs = map[string]bool{
	".git": true, "vendor": true, "node_modules": true, "target": true,
	"build": true, "dist": true, "testdata": true, ".claude": true,
}

// documentNames, in the order a directory holding two spellings of the same
// document is read: the yaml, and the json only when there is no yaml.
var documentNames = []string{"openapi.yaml", "openapi.yml", "swagger.yaml", "swagger.yml", "openapi.json", "swagger.json"}

type role int

const (
	roleUnknown role = iota
	roleServed
	roleCalled
)

// discover walks the tree for documents and answers with what the service
// provides and the systems outside the estate it calls.
func discover(root, owner string, opts Options, b *plugin.Builder) ([]catalog.RpcService, []catalog.External) {
	var provides []catalog.RpcService
	var externals []catalog.External
	byID := map[string]int{}

	for _, path := range documents(root) {
		source := filepath.ToSlash(path)
		doc, err := load(path)
		if err != nil {
			b.Warn(owner, source+" could not be read: "+err.Error())

			continue
		}

		switch roleOf(filepath.Dir(path)) {
		case roleServed:
			api := firstNonEmpty(opts.API, apiID(doc))
			services := rpcServices(doc, api, source, b)
			if len(services) == 0 {
				b.Warn(owner, source+" declares no operations")
			}
			provides = append(provides, services...)

		case roleCalled:
			api := apiID(doc)
			if _, ours := opts.Peers[api]; ours {
				// One of ours: the service that implements it describes it.
				continue
			}
			info := child(doc.root, "info")
			title := text(child(info, "title"))
			id := opts.Externals[api]
			if id == "" {
				id = openapi.ExternalID(title)
			}
			if id == "" {
				b.Warn(owner, source+" is called from here and its document has no title, so the system it belongs to cannot be named; name it under `externals` as "+api+"")

				continue
			}
			if strings.Contains(id, ".") {
				b.Warn(owner, source+": external "+id+" has a dot in its id; an external sits at the root and is addressed by a bare name")

				continue
			}
			services := rpcServices(doc, api, source, b)
			if at, seen := byID[id]; seen {
				externals[at].Provides = append(externals[at].Provides, services...)

				continue
			}
			byID[id] = len(externals)
			externals = append(externals, catalog.External{
				ID:       id,
				Slug:     id,
				Name:     firstNonEmpty(title, id),
				Summary:  text(child(info, "description")),
				URL:      text(child(doc.root, "externalDocs", "url")),
				Provides: services,
			})

		default:
			b.Warn(owner, "found "+source+", and nothing beside it says whether this service implements it or calls it; name it in `spec`, or generate a server or a client from it")
		}
	}

	if len(provides) == 0 {
		b.Warn(owner, "no document this service implements was found under "+root+"; the service is described as providing no HTTP api")
	}

	return provides, externals
}

// documents lists every document under the root, one per directory, in path
// order so the fragment is the same however the tree was walked.
func documents(root string) []string {
	perDir := map[string]string{}
	_ = filepath.WalkDir(root, func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if p != root && skippedDirs[entry.Name()] {
				return filepath.SkipDir
			}

			return nil
		}
		rank := indexOf(documentNames, entry.Name())
		if rank < 0 {
			return nil
		}
		dir := filepath.Dir(p)
		if held, ok := perDir[dir]; ok && indexOf(documentNames, filepath.Base(held)) <= rank {
			return nil
		}
		perDir[dir] = p

		return nil
	})

	out := make([]string, 0, len(perDir))
	for _, p := range perDir {
		out = append(out, p)
	}
	sort.Strings(out)

	return out
}

func indexOf(names []string, name string) int {
	for i, candidate := range names {
		if candidate == name {
			return i
		}
	}

	return -1
}

// roleOf reads the files in the document's directory and the one above it,
// which is where generated code and the adapter written over it live.
// Implementing wins over calling: a service that publishes a client for its
// own api has both beside its document, and it still implements it.
func roleOf(dir string) role {
	served, called := false, false
	for _, d := range []string{dir, filepath.Dir(dir)} {
		entries, err := os.ReadDir(d)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := strings.ToLower(entry.Name())
			switch {
			case strings.HasSuffix(name, ".go"):
				switch goRole(filepath.Join(d, entry.Name())) {
				case roleServed:
					served = true
				case roleCalled:
					called = true
				}
			case isSourceFile(name):
				if strings.Contains(name, "server") || strings.Contains(name, "handler") || strings.Contains(name, "controller") || strings.Contains(name, "router") || strings.Contains(name, "routes") {
					served = true
				} else if strings.Contains(name, "client") {
					called = true
				}
			}
		}
	}

	switch {
	case served:
		return roleServed
	case called:
		return roleCalled
	}

	return roleUnknown
}

// goRole reads what a Go file was generated as, by the names generators
// leave: oapi-codegen's ServerInterface and RegisterHandlers, swag's
// registration, and oapi-codegen's ClientInterface.
func goRole(path string) role {
	contents, err := os.ReadFile(path)
	if err != nil {
		return roleUnknown
	}
	src := string(contents)
	switch {
	case strings.Contains(src, "ServerInterface interface"),
		strings.Contains(src, "func RegisterHandlers("),
		strings.Contains(src, "swag.Register("),
		strings.Contains(src, "SwaggerInfo"):
		return roleServed
	case strings.Contains(src, "ClientInterface interface"),
		strings.Contains(src, "ClientWithResponses"):
		return roleCalled
	}

	return roleUnknown
}

// The source files a name-based reading applies to: anything a person writes
// an adapter in, and nothing a tool writes for other reasons.
func isSourceFile(name string) bool {
	for _, ext := range []string{".ts", ".tsx", ".js", ".mjs", ".java", ".kt", ".rs", ".py", ".rb", ".cs", ".php"} {
		if strings.HasSuffix(name, ext) {
			return true
		}
	}

	return false
}
