package main

import (
	"go/parser"
	"go/token"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// readStore builds one store out of every migration in the repository layer.
//
// One store, not one per aggregate: the migrations are numbered inside their
// own package and each keeps its own schema_migrations table, but they are all
// applied to the same database. The numbering is about who waits for whom, not
// about where the rows live.
func readStore(root, repositories, storeID, owner string, b *plugin.Builder) []catalog.Table {
	tables := []catalog.Table{}

	for _, aggregate := range subdirs(root, repositories) {
		dir := path.Join(repositories, aggregate, "migrations")

		files, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(dir)))
		if err != nil {
			// A repository package with no migrations of its own is normal:
			// not every adapter keeps rows.
			continue
		}

		names := make([]string, 0, len(files))
		for _, file := range files {
			// Only the up direction describes the schema. A down migration
			// says how to lose it.
			if !file.IsDir() && strings.HasSuffix(file.Name(), ".up.sql") {
				names = append(names, file.Name())
			}
		}
		// Applied in name order, so read in name order: a later migration is
		// allowed to know about an earlier one.
		sort.Strings(names)

		aggregateID := owner + "." + aggregate
		first := true

		for _, name := range names {
			source := path.Join(dir, name)

			sql, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(source)))
			if err != nil {
				b.Warn(storeID, source+" could not be read: "+err.Error())

				continue
			}

			relations, unread, err := readDDL(string(sql), source)
			if err != nil {
				b.Warn(storeID, "could not parse "+source+": "+err.Error())

				continue
			}
			for _, note := range unread {
				b.Warn(storeID, source+": "+note)
			}

			for _, relation := range relations {
				table := relation.table
				table.ID = storeID + "." + table.Name
				table.Indexes = relation.indexes
				// The layout is the claim: these rows exist because this
				// aggregate exists, and its schema lives beside the code that
				// reads it.
				table.Persists = &catalog.Persists{Aggregate: aggregateID}

				// The first table an aggregate creates holds the aggregate
				// itself; anything it creates afterwards hangs off it.
				if first {
					table.Role = catalog.TableRoleAggregateRoot
					first = false
				} else {
					table.Role = catalog.TableRoleChild
				}

				tables = append(tables, table)
			}
		}
	}

	return tables
}

// resolveForeignKeys turns the table names the grammar gives into table ids the
// catalog can follow. A key pointing outside this store keeps the raw name and
// is reported: it crosses a boundary this extractor cannot see the far side of.
func resolveForeignKeys(storeID string, tables []catalog.Table, b *plugin.Builder) {
	known := map[string]bool{}
	for i := range tables {
		known[tables[i].Name] = true
	}

	for i := range tables {
		for j := range tables[i].Columns {
			fk := tables[i].Columns[j].FK
			if fk == nil {
				continue
			}
			if !known[fk.Table] {
				b.Warn(tables[i].ID, "column "+tables[i].Columns[j].Name+" references "+fk.Table+", which no migration here creates")

				continue
			}
			fk.Table = storeID + "." + fk.Table
		}
	}
}

// foreignSchemas reports migrations applied from outside this module.
//
// A service can bring a table with a dependency - an outbox published by an
// SDK, say - and its DDL is then in that module rather than in this tree. The
// table is real, the catalog cannot describe it, and silence would read as
// "there is no such table".
//
// What is checked is the IMPORT PATH, never the name a file refers to the
// package by. `userrepo.Migrations` and `sdkoutbox.Migrations` look equally
// foreign as identifiers, and only the path says that one of them is the
// repository package next door.
func foreignSchemas(root, module string, b *plugin.Builder, storeID string) {
	if module == "" {
		return
	}

	reported := map[string]bool{}
	fset := token.NewFileSet()

	_ = filepath.WalkDir(filepath.Join(root, "internal"), func(p string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") {
			return nil
		}
		if strings.HasSuffix(entry.Name(), "_test.go") {
			// A test standing up its own schema says nothing about what the
			// service deploys.
			return nil
		}

		file, err := parser.ParseFile(fset, p, nil, parser.ImportsOnly|parser.SkipObjectResolution)
		if err != nil {
			return nil
		}

		paths := map[string]string{}
		for _, spec := range file.Imports {
			importPath := strings.Trim(spec.Path.Value, `"`)
			name := path.Base(importPath)
			if spec.Name != nil {
				name = spec.Name.Name
			}
			paths[name] = importPath
		}

		// Imports only got parsed above, so the bodies are gone; the file is
		// read again for the one selector that matters.
		source, err := os.ReadFile(p)
		if err != nil {
			return nil
		}

		for _, match := range migrationsRef.FindAllStringSubmatch(string(source), -1) {
			importPath, known := paths[match[1]]
			if !known || reported[importPath] {
				continue
			}
			if strings.HasPrefix(importPath, module) {
				continue
			}

			reported[importPath] = true
			b.Warn(storeID, "migrations are applied from "+importPath+", whose schema is not in this tree; the tables it creates are missing from this store")
		}

		return nil
	})
}

// migrationsRef finds `<pkg>.Migrations`, which is how a migration set is
// handed to the migrator. A regular expression rather than a walk of the
// bodies: this produces a diagnostic and never a fact, and the day it misses
// one nothing in the catalog is wrong - there is only one fewer warning.
var migrationsRef = regexp.MustCompile(`(\w+)\.Migrations\b`)

// modulePath is the module line of go.mod: what "inside this tree" means.
func modulePath(root string) string {
	source, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		return ""
	}

	for _, line := range strings.Split(string(source), "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
			return strings.TrimSpace(rest)
		}
	}

	return ""
}

func subdirs(root, rel string) []string {
	entries, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return nil
	}

	var out []string
	for _, entry := range entries {
		if entry.IsDir() {
			out = append(out, entry.Name())
		}
	}

	return out
}
