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
func readStore(root, repositories, storeID, owner string, b *plugin.Builder) ([]catalog.Table, []catalog.View) {
	tables := []catalog.Table{}
	views := []catalog.View{}

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
			// says how to lose it; a migration with no direction in its name
			// only goes up.
			if !file.IsDir() && strings.HasSuffix(file.Name(), ".sql") && !strings.HasSuffix(file.Name(), ".down.sql") {
				names = append(names, file.Name())
			}
		}
		// Applied in name order, so read in name order: a later migration is
		// allowed to know about an earlier one.
		sort.Strings(names)

		// The directory names the aggregate, and an id spells it the way every
		// extractor spells one: price_list is price-list.
		aggregateID := owner + "." + slug(aggregate)
		// Which column carries which field, read from the statements that
		// write the rows rather than from the column names.
		mapped := readMaps(root, repositories, aggregate, b)
		for _, more := range []map[string]map[string]string{
			readMapsTS(root, repositories, aggregate, b),
			readMapsRust(root, repositories, aggregate, b),
			readMapsJava(root, repositories, aggregate, b),
		} {
			for table, columns := range more {
				if _, ok := mapped[table]; !ok {
					mapped[table] = columns
				}
			}
		}
		state := newDDLState()
		copies := map[string]map[string][]string{}

		for _, name := range names {
			source := path.Join(dir, name)

			sql, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(source)))
			if err != nil {
				b.Warn(storeID, source+" could not be read: "+err.Error())

				continue
			}

			for table, columns := range readCopies(string(sql), storeID) {
				if copies[table] == nil {
					copies[table] = map[string][]string{}
				}
				for column, from := range columns {
					copies[table][column] = from
				}
			}
			unread, err := state.apply(string(sql), source)
			if err != nil {
				b.Warn(storeID, "could not parse "+source+": "+err.Error())

				continue
			}
			for _, note := range unread {
				b.Warn(storeID, source+": "+note)
			}
		}

		first := true
		for _, relation := range state.relations {
			table := relation.table
			table.ID = storeID + "." + table.Name
			table.Indexes = relation.indexes
			// An outbox holds messages on their way out, not the
			// aggregate: it is created beside the aggregate because the
			// repository writes both in one transaction, and that is all
			// the layout says about it.
			if isOutbox(table.Name) {
				table.Role = catalog.TableRoleOutbox
				tables = append(tables, table)

				continue
			}

			// The layout is the claim: these rows exist because this
			// aggregate exists, and its schema lives beside the code that
			// reads it.
			table.Persists = &catalog.Persists{Aggregate: aggregateID}

			for i := range table.Columns {
				if field, ok := mapped[table.Name][table.Columns[i].Name]; ok {
					table.Columns[i].Maps = field
				}
				// Where the value came from, when the migration says. A
				// table cannot show a copy the way a view shows a select,
				// so the copy is declared beside the column it lands in.
				if from, ok := copies[table.Name][table.Columns[i].Name]; ok {
					table.Columns[i].From = from
				}
			}

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
		for _, declared := range state.views {
			views = append(views, declared.asCatalog(storeID, declared.source, tables))
		}
	}

	// A view is read where it is written, which may be before the tables it
	// reads are: the second pass is what lets a column take its type from the
	// column it comes from wherever that was created.
	for i := range views {
		views[i] = resolveView(views[i], storeID, tables)
	}

	return tables, views
}

// resolveView fills in what a view could not know when it was read: the type,
// nullability and mapping of every column that comes from exactly one place.
func resolveView(held catalog.View, storeID string, tables []catalog.Table) catalog.View {
	for i := range held.Columns {
		column := &held.Columns[i]
		if column.Type != "" || len(column.From) != 1 {
			continue
		}
		at := strings.LastIndex(column.From[0], ".")
		if at < 0 {
			continue
		}
		if source := columnOf(tables, column.From[0][:at], column.From[0][at+1:]); source != nil {
			column.Type = source.Type
			column.Nullable = source.Nullable
			column.Maps = source.Maps
		}
	}
	if held.Persists == nil {
		persists := ""
		for _, read := range held.Reads {
			table := tableOf(tables, read)
			if table == nil || table.Persists == nil {
				continue
			}
			if persists == "" {
				persists = table.Persists.Aggregate

				continue
			}
			if persists != table.Persists.Aggregate {
				persists = ""

				break
			}
		}
		if persists != "" {
			held.Persists = &catalog.Persists{Aggregate: persists}
		}
	}

	return held
}

// isOutbox says whether a table is the outbox by its name, which is the one
// convention every outbox library shares.
func isOutbox(name string) bool {
	return name == "outbox" || strings.HasSuffix(name, "_outbox")
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
