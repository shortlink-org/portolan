// Package main is portolan-extract-sql: the migrations of a service in, a
// catalog fragment describing where its state lives out.
//
// It reads the DDL with PostgreSQL's own grammar ported to Go, so it needs no
// database, no Docker and no external binary - the same property every other
// extractor here has, and the reason this does not shell out to a migration
// tool to be told what the files build.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the extractor: the things the migrations
// themselves do not say about the estate they belong to.
type Options struct {
	Context string `json:"context"`
	Service string `json:"service"`

	// Store names the database these migrations build. One service can keep
	// state in more than one, and a slug is how the two are told apart.
	Store string `json:"store,omitempty"`
	Name  string `json:"name,omitempty"`
	Kind  string `json:"kind,omitempty"`

	// Repositories is where the adapters live, relative to the input root.
	Repositories string `json:"repositories,omitempty"`

	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-extract-sql:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	in, err := io.ReadAll(stdin)
	if err != nil {
		return fmt.Errorf("reading the request: %w", err)
	}

	var req plugin.Request
	if err := json.Unmarshal(in, &req); err != nil {
		return fmt.Errorf("the request is not a portolan plugin request: %w", err)
	}

	var opts Options
	if len(req.Options) > 0 {
		if err := json.Unmarshal(req.Options, &opts); err != nil {
			return fmt.Errorf("options: %w", err)
		}
	}

	if req.Input.Root == "" {
		return fmt.Errorf("no input root: an extractor has nothing to read")
	}

	out, err := json.Marshal(extract(req.Input, opts))
	if err != nil {
		return fmt.Errorf("encoding the response: %w", err)
	}

	if _, err := stdout.Write(out); err != nil {
		return fmt.Errorf("writing the response: %w", err)
	}

	return nil
}

func extract(in plugin.Input, opts Options) plugin.Response {
	b := &plugin.Builder{}
	root := in.Root

	if opts.Context == "" {
		opts.Context = filepath.Base(root)
	}
	if opts.Service == "" {
		opts.Service = filepath.Base(root)
	}
	if opts.Store == "" {
		opts.Store = "pg"
	}
	if opts.Kind == "" {
		opts.Kind = string(catalog.StoreKindPostgres)
	}
	if opts.Repositories == "" {
		opts.Repositories = "internal/infrastructure/repository"
	}

	owner := opts.Context + "." + opts.Service
	storeID := owner + "." + opts.Store

	tables := readStore(root, opts.Repositories, storeID, owner, b)
	resolveForeignKeys(storeID, tables, b)
	foreignSchemas(root, modulePath(root), b, storeID)

	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts: []catalog.BoundedContext{{
			ID:   opts.Context,
			Slug: opts.Context,
			// Only the link from the service to its store. What the service is
			// called, and what it holds, belong to the extractors that read
			// those things.
			Services: []catalog.Service{{
				ID:         owner,
				Slug:       opts.Service,
				Provides:   []catalog.RpcService{},
				Consumes:   []catalog.RpcCall{},
				Aggregates: []catalog.Aggregate{},
				Stores:     []string{storeID},
			}},
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{},
		Adrs:  []catalog.Adr{},
	}

	if len(tables) == 0 {
		b.Warn(storeID, "no migrations under "+opts.Repositories+"; the service is described as keeping no state")
	} else {
		fragment.Stores = []catalog.Store{{
			ID:     storeID,
			Slug:   opts.Store,
			Name:   firstNonEmpty(opts.Name, opts.Service+" database"),
			Kind:   catalog.StoreKind(opts.Kind),
			Owner:  owner,
			Source: filepath.ToSlash(filepath.Join(root, opts.Repositories)),
			Tables: tables,
		}}
	}

	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		b.Warn(storeID, "the fragment could not be encoded: "+err.Error())

		return b.Response()
	}

	b.File(firstNonEmpty(opts.Out, "stores.json"), string(encoded)+"\n")

	return b.Response()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}

	return ""
}
