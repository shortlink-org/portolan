package main

// Protos in, a catalog fragment out.
//
// This extractor describes ONE aspect of a service - what it answers and what
// it calls - and nothing else. The aggregates come from a different extractor
// reading a different part of the tree, and the two meet in the merge. Neither
// knows the other exists, which is the whole reason each of them stays small.
//
// It reads no clock, opens no socket and looks at no environment. Fetching a
// module from a registry is the other plugin's job, and keeping the two apart
// is what lets this one be replayed byte-for-byte from a checkout.
//
// A note on proto event schemas: a message named `OrderPlaced` in an
// `events.proto` is the WIRE SCHEMA OF a domain event, not the event. It stays
// an RpcMessage rather than becoming a catalog Event, because `Event.id` is
// `<service>.<aggregate>.<Name>` and this extractor knows the package, not the
// aggregate. A guess would either collide with the event extract-go already
// emits from the domain package, or create a ghost under an invented aggregate
// - and since aggregates merge whole-object by id, that ghost would sit beside
// the real one forever.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	root := in.Root

	if opts.Context == "" {
		opts.Context = filepath.Base(root)
	}
	if opts.Service == "" {
		opts.Service = filepath.Base(root)
	}
	serviceID := opts.Context + "." + opts.Service

	owned, err := readDirs(root, opts.Paths, b)
	if err != nil {
		return plugin.Response{}, err
	}
	vendored, err := readDirs(root, opts.Vendored, b)
	if err != nil {
		return plugin.Response{}, err
	}

	if len(owned) == 0 && len(vendored) == 0 {
		b.Warn(serviceID, "no .proto files were found under "+root)
	}

	// One index over everything read. A vendored copy may well refer to a type
	// the owned protos declare, and refusing to look would report an unresolved
	// name the tree can plainly answer.
	all := append(append([]*File{}, filesOf(owned)...), filesOf(vendored)...)
	ix := NewIndex(all)

	sh := newShared(opts.Defs != "off")

	var provides []catalog.RpcService
	var consumes []catalog.RpcCall
	var modules []catalog.ProtoModule
	moduleIDs := map[string]bool{}

	for _, dir := range owned {
		module := describe(root, dir, opts, b)
		if module.ID != "" && !moduleIDs[module.ID] {
			// Owned: this service publishes it, so the estate knows the owner.
			module.Owner = serviceID
			modules = append(modules, module)
			moduleIDs[module.ID] = true
		}
		provides = append(provides, interfaces(ix, dir.files, module.ID, sh, b)...)
	}

	for _, dir := range vendored {
		module := describe(root, dir, opts, b)
		if module.ID != "" && !moduleIDs[module.ID] {
			// Vendored: somebody else publishes it. Owner is left empty rather
			// than guessed - a module whose publisher is outside the estate is
			// the ordinary case, not a defect.
			modules = append(modules, module)
			moduleIDs[module.ID] = true
		}
		consumes = append(consumes, calls(dir.files, opts.Peers, module.ID, b)...)
	}

	sort.Slice(modules, func(i, j int) bool { return modules[i].ID < modules[j].ID })

	service := catalog.Service{
		ID:   serviceID,
		Slug: opts.Service,
		// Named by whichever source knows the name. This one describes what the
		// service answers and calls, not what it is called, and a fragment that
		// filled these in from a proto package would be inventing.
		Provides:   nonNilProvides(provides),
		Consumes:   nonNilCalls(consumes),
		Aggregates: []catalog.Aggregate{},
		Modules:    sortedCopy(keysOf(moduleIDs)),
	}

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts: []catalog.BoundedContext{{
			ID:       opts.Context,
			Slug:     opts.Context,
			Services: []catalog.Service{service},
		}},
		Defs:    sh.defs,
		Flows:   []catalog.Flow{},
		Adrs:    []catalog.Adr{},
		Modules: modules,
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}

	b.File(firstNonEmpty(opts.Out, "proto.json"), string(encoded)+"\n")

	return b.Response(), nil
}

// dir is one directory of protos and everything parsed out of it.
type dir struct {
	path  string
	files []*File
	lock  *lockFile
}

func filesOf(dirs []dir) []*File {
	var out []*File
	for _, d := range dirs {
		out = append(out, d.files...)
	}

	return out
}

// readDirs walks each directory for .proto files and parses them.
//
// Files are visited in sorted order and parsed in that order, because the
// fragment is committed and compared by `gen:check`: a filesystem walk that
// came back differently would rewrite the file for no reason.
func readDirs(root string, paths []string, b *plugin.Builder) ([]dir, error) {
	var out []dir

	for _, rel := range paths {
		at := filepath.Join(root, filepath.FromSlash(rel))
		info, err := os.Stat(at)
		if os.IsNotExist(err) {
			b.Warn(rel, "no such directory: "+filepath.ToSlash(at))

			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("%s is not a directory", filepath.ToSlash(at))
		}

		var found []string
		err = filepath.Walk(at, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() && strings.HasSuffix(path, ".proto") {
				found = append(found, path)
			}

			return nil
		})
		if err != nil {
			return nil, err
		}
		sort.Strings(found)

		d := dir{path: trimSlash(at)}
		for _, path := range found {
			src, err := os.ReadFile(path)
			if err != nil {
				return nil, err
			}
			file, notes, err := Parse(filepath.ToSlash(path), string(src))
			if err != nil {
				// The file could not be tokenised. Past that the parser is not
				// reading proto any more, so it is reported and skipped rather
				// than half-described.
				b.Warn(filepath.ToSlash(path), err.Error())

				continue
			}
			for _, note := range notes {
				b.Warn(fmt.Sprintf("%s:%d", filepath.ToSlash(path), note.Line), note.Message)
			}
			d.files = append(d.files, file)
		}

		lock, err := readLock(at)
		if err != nil {
			b.Warn(rel, "the lock beside these protos could not be read: "+err.Error())
		}
		d.lock = lock

		out = append(out, d)
	}

	return out, nil
}

// describe names the module a directory of protos belongs to.
//
// A lock written by fetch-bsr wins, because it is the only thing that knows the
// commit. Failing that the manifest may say, and failing that the directory
// gets a `local:` id so nobody mistakes the path for something fetchable.
func describe(root string, d dir, opts Options, b *plugin.Builder) catalog.ProtoModule {
	rel := relativeTo(root, d.path)

	id := ""
	var lock *lockModule
	if d.lock != nil && len(d.lock.Modules) > 0 {
		lock = &d.lock.Modules[0]
		id = lock.Module
		if len(d.lock.Modules) > 1 {
			b.Warn(rel, "the lock names more than one module for this directory; the first is used")
		}
	}
	if id == "" {
		id = opts.Modules[rel]
	}
	if id == "" {
		id = localModuleID(relativeTo(root, d.path))
		b.Warn(rel, "these protos are not pinned to a published module; listed as "+id)
	}

	module := moduleFor(id, d.path, d.files)
	module.Source = filepath.ToSlash(d.path)
	if lock != nil {
		module.Commit = lock.Commit
		module.Digest = lock.Digest
		module.Deps = sortedCopy(lock.Deps)
	}

	return module
}

func keysOf(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}

	return out
}

// A fragment states what it knows and nothing else, but a list the schema calls
// required has to be present even when it is empty.
func nonNilProvides(in []catalog.RpcService) []catalog.RpcService {
	if in == nil {
		return []catalog.RpcService{}
	}

	return in
}

func nonNilCalls(in []catalog.RpcCall) []catalog.RpcCall {
	if in == nil {
		return []catalog.RpcCall{}
	}

	return in
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}

	return ""
}
