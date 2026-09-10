package extractsql

import (
	"go/ast"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

// readStore builds one store out of every migration in the infrastructure
// layer: the repository packages, and the projector packages beside them.
//
// One store, not one per aggregate: the migrations are numbered inside their
// own package and each keeps its own schema_migrations table, but they are all
// applied to the same database. The numbering is about who waits for whom, not
// about where the rows live.
func readStore(root string, layout storageLayout, storeID, owner string, b *plugin.Builder) ([]catalog.Table, []catalog.View) {
	tables := []catalog.Table{}
	views := []catalog.View{}
	accesses := map[string][]catalog.TableAccess{}
	readAccesses := map[string]bool{}
	collectAccesses := func(dir, aggregate string) {
		if readAccesses[dir] {
			return
		}
		readAccesses[dir] = true
		mergeTableAccesses(accesses, readTableAccesses(root, dir, aggregate, layout.index))
	}

	for _, repository := range layout.repositories {
		aggregate := repository.name
		dir := repository.migrations
		collectAccesses(repository.dir, aggregate)
		// Plain migration directories do not locate their SQL callers. Reuse
		// the module index to find accesses in storage packages elsewhere.
		if packageName(strings.Split(repository.dir, "/"), "repository") == "" && layout.index != nil {
			for _, sourceDir := range layout.index.PackageDirs(".") {
				collectAccesses(sourceDir, "")
			}
		}

		state, copies, declaredAggregates, ok := readMigrations(root, dir, storeID, owner, b)
		if !ok {
			// A repository package with no migrations of its own is normal:
			// not every adapter keeps rows.
			continue
		}

		// The directory names the aggregate, and an id spells it the way every
		// extractor spells one: price_list is price-list.
		aggregateRef := ""
		domainSource := repositoryDomain(root, aggregate, layout.index)
		if domainSource != "" {
			aggregateRef = owner + "." + slug(aggregate)
		}
		// Which column carries which field, read from the statements that
		// write the rows rather than from the column names.
		mapped := readMaps(root, repository.dir, aggregate, b, layout.index)
		for _, more := range []map[string]map[string]string{
			readMapsTS(root, repository.dir, aggregate, b),
			readMapsRust(root, repository.dir, aggregate, b),
			readMapsJava(root, repository.dir, aggregate, b),
		} {
			for table, columns := range more {
				if _, ok := mapped[table]; !ok {
					mapped[table] = columns
				}
			}
		}

		first := true
		for _, relation := range state.relations {
			table := finishTable(relation, state, storeID)
			// An outbox holds messages on their way out, not the
			// aggregate: it is created beside the aggregate because the
			// repository writes both in one transaction, and that is all
			// the layout says about it.
			if isOutbox(lastNamePart(table.Name)) {
				table.Role = catalog.TableRoleOutbox
				tables = append(tables, table)

				continue
			}

			// The layout is the claim: these rows exist because this
			// aggregate exists, and its schema lives beside the code that
			// reads it.
			target := firstNonEmpty(forTable(declaredAggregates, table.Name), aggregateRef)
			if target != "" {
				rule := "domain-root-and-repository-layout"
				evidence := []catalog.RelationEvidence{{Kind: "binding", Rule: rule, Source: domainSource, Symbol: target}}
				if explicit := forTable(declaredAggregates, table.Name); explicit != "" {
					evidence = []catalog.RelationEvidence{{Kind: "binding", Rule: "migration-aggregate-annotation", Source: forTable(state.aggregateSources, table.Name), Symbol: explicit}}
				}
				table.Persists = &catalog.Persists{Aggregate: target, Evidence: evidence}
			}

			mapping := forTable(mapped, table.Name)
			for i := range table.Columns {
				if field, ok := mapping[table.Columns[i].Name]; ok && table.Persists != nil {
					table.Columns[i].Maps = field
				}
			}
			applyCopies(&table, copies)

			// The first table an aggregate creates holds the aggregate
			// itself; anything it creates afterwards hangs off it.
			if table.Persists == nil {
				tables = append(tables, table)
				continue
			}
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

	// A projector package holds one projection: rows assembled from events,
	// kept by a subscriber that writes and nothing else. The layout says the
	// role. It does not say whose rows these are a picture of - a projection
	// of another service's aggregate lives here too, and its name is not in
	// any directory of this tree - so the link is taken from the migration
	// when it is written there (`-- aggregate:`) and left out when it is not.
	for _, projector := range layout.projectors {
		dir := projector.migrations
		collectAccesses(projector.dir, projector.name)

		state, copies, projected, ok := readMigrations(root, dir, storeID, owner, b)
		if !ok {
			continue
		}

		for _, relation := range state.relations {
			table := finishTable(relation, state, storeID)
			table.Role = catalog.TableRoleProjection
			if aggregate := forTable(projected, table.Name); aggregate != "" {
				table.Persists = &catalog.Persists{Aggregate: aggregate, Evidence: []catalog.RelationEvidence{{Kind: "binding", Rule: "migration-aggregate-annotation", Source: forTable(state.aggregateSources, table.Name), Symbol: aggregate}}}
			}
			// No `maps`: the upsert in a projector writes what an event
			// carries, and an event's field is not a field of the aggregate
			// the way a repository's insert argument is. Where a value came
			// from is said by `-- from:`, which is read.
			applyCopies(&table, copies)

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
	attachTableAccesses(tables, accesses)

	return tables, views
}

// readMigrations applies every up migration under dir, in name order, and
// reads the comments the grammar drops: which columns are copies (`-- from:`)
// and which aggregate a table is a picture of (`-- aggregate:`). ok is false
// when there is no such directory.
func readMigrations(root, dir, storeID, owner string, b *plugin.Builder) (*ddlState, map[string]map[string][]string, map[string]string, bool) {
	files, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(dir)))
	if err != nil {
		return nil, nil, nil, false
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

	state := newDDLState()
	copies := map[string]map[string][]string{}
	projected := map[string]string{}

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
		for table, aggregate := range readProjected(string(sql), owner) {
			projected[table] = aggregate
			state.aggregateSources[table] = source
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

	return state, copies, projected, true
}

// finishTable gives a relation its place in the catalog: an id under the
// store, its indexes, and its column types spelled the way the migration
// spelled them.
func finishTable(relation relation, state *ddlState, storeID string) catalog.Table {
	table := relation.table
	table.ID = storeID + "." + table.Name
	table.Indexes = relation.indexes
	for i := range table.Columns {
		table.Columns[i].Type = state.renderType(table.Columns[i].Type)
	}

	return table
}

// applyCopies writes onto each column where its value came from, when the
// migration says. A table cannot show a copy the way a view shows a select,
// so the copy is declared beside the column it lands in.
func applyCopies(table *catalog.Table, copies map[string]map[string][]string) {
	copying := forTable(copies, table.Name)
	for i := range table.Columns {
		if from, ok := copying[table.Columns[i].Name]; ok {
			table.Columns[i].From = from
		}
	}
}

// forTable looks a table up by the name the migration used, then by its
// unqualified name: a comment says `orders`, the grammar says `sales.orders`.
func forTable[T any](byName map[string]T, name string) T {
	if held, ok := byName[name]; ok {
		return held
	}

	return byName[lastNamePart(name)]
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
func foreignSchemas(root, module string, b *plugin.Builder, storeID string, indexes ...*goscan.Tree) {
	if module == "" {
		return
	}

	reported := map[string]bool{}
	index, err := goscan.PackageIndex(root, ".", indexes...)
	if err != nil {
		return
	}
	for _, file := range index.Files {
		if file.Generated {
			continue
		}
		paths := file.Imports
		source, err := os.ReadFile(filepath.Join(root, file.Name))
		if err != nil {
			continue
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

	}
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

// A conventional repository is not itself an aggregate. For Go, require the
// same root struct and domain layout accepted by the domain extractor.
func repositoryDomain(root, name string, index *goscan.Tree) string {
	if index != nil {
		for _, dir := range []string{"internal/domain/" + name, "internal/" + name + "/domain"} {
			for _, file := range index.PackageFiles(dir) {
				if file.Generated {
					continue
				}
				rootName := title(file.Node.Name.Name)
				if file.Node.Name.Name == "domain" {
					rootName = title(name)
				}
				for _, decl := range file.Node.Decls {
					gen, ok := decl.(*ast.GenDecl)
					if !ok {
						continue
					}
					for _, spec := range gen.Specs {
						typ, ok := spec.(*ast.TypeSpec)
						if !ok || typ.Name.Name != rootName {
							continue
						}
						if _, ok := typ.Type.(*ast.StructType); ok {
							return index.At(typ.Pos()).String()
						}
					}
				}
			}
		}
	}
	for _, candidate := range []string{
		"src/domain/" + name + "/" + name + ".ts",
		"src/domain/" + name + "/mod.rs",
		"src/main/java/domain/" + name + "/" + title(name) + ".java",
	} {
		if info, err := os.Stat(filepath.Join(root, candidate)); err == nil && !info.IsDir() {
			return candidate
		}
	}
	var javaSource string
	_ = filepath.WalkDir(filepath.Join(root, "src/main/java"), func(filename string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !entry.IsDir() && strings.HasSuffix(filepath.ToSlash(filename), "/domain/"+name+"/"+title(name)+".java") {
			rel, _ := filepath.Rel(root, filename)
			javaSource = filepath.ToSlash(rel)
		}
		return nil
	})
	return javaSource
}
