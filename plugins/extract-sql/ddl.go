package main

import (
	"fmt"
	"strings"

	"github.com/pgplex/pgparser/nodes"
	"github.com/pgplex/pgparser/parser"

	"github.com/shortlink-org/portolan/catalog"
)

// Reading DDL.
//
// The parse tree comes from pgplex/pgparser, which is PostgreSQL's own grammar
// ported to Go: no cgo, no database, no external binary. That matters more than
// it sounds. Every other extractor here runs on a bare checkout, and the
// alternative - replaying the migrations into a dev database to be told what
// they built - would have made generating a catalog need Docker.
//
// What is read is deliberately a small part of what the grammar accepts:
// tables, their columns, their keys, and the indexes over them. Anything else
// in the file is reported rather than skipped, because a migration this does
// not understand is a schema the catalog is quietly wrong about.

type relation struct {
	table       catalog.Table
	indexes     []catalog.TableIndex
	notNull     map[string]bool
	constraints map[string]constraintEffect
}

type constraintEffect struct {
	kind    nodes.ConstrType
	columns []string
}

type declaredView struct {
	view
	source string
}

// ddlState is the schema after every migration applied so far. Keeping it
// across files is the important distinction from the old extractor, which
// emitted every CREATE it saw and could neither attach a later index nor
// account for ALTER, RENAME and DROP.
type ddlState struct {
	relations  []relation
	relationAt map[string]int
	views      []declaredView
	viewAt     map[string]int
	enums      map[string][]string
}

func newDDLState() *ddlState {
	return &ddlState{relationAt: map[string]int{}, viewAt: map[string]int{}, enums: map[string][]string{}}
}

// readDDL turns one migration into the tables and views it creates, in the
// order it creates them.
func readDDL(sql, source string) ([]relation, []view, []string, error) {
	state := newDDLState()
	unread, err := state.apply(sql, source)
	if err != nil {
		return nil, nil, nil, err
	}
	views := make([]view, 0, len(state.views))
	for _, held := range state.views {
		views = append(views, held.view)
	}
	return state.relations, views, unread, nil
}

func (s *ddlState) apply(sql, source string) ([]string, error) {
	tree, err := parser.Parse(sql)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", source, err)
	}

	var unread []string

	for _, item := range tree.Items {
		switch stmt := item.(type) {
		case *nodes.CreateStmt:
			s.addRelation(readRelation(stmt))

		case *nodes.CreateSchemaStmt:
			// Schemas namespace the relations and types below; they do not need
			// a catalog object of their own.

		case *nodes.CreateEnumStmt:
			s.enums[qualifiedName(stringList(stmt.TypeName))] = stringList(stmt.Vals)

		case *nodes.AlterEnumStmt:
			if note := s.alterEnum(stmt); note != "" {
				unread = append(unread, note)
			}

		case *nodes.ViewStmt:
			s.addView(declaredView{view: readView(stmt, sql), source: source})

		case *nodes.CreateTableAsStmt:
			materialized, ok := readMaterializedView(stmt, sql)
			if !ok {
				unread = append(unread, fmt.Sprintf("%T is not read", stmt))

				continue
			}
			s.addView(declaredView{view: materialized, source: source})

		case *nodes.IndexStmt:
			name := relationName(stmt.Relation)
			at, known := s.relationAt[name]
			if !known {
				unread = append(unread, fmt.Sprintf("index %q is on unknown table %q", stmt.Idxname, name))

				continue
			}
			s.relations[at].indexes = append(s.relations[at].indexes, readIndex(stmt))

		case *nodes.AlterTableStmt:
			unread = append(unread, s.alter(stmt)...)

		case *nodes.RenameStmt:
			if note := s.rename(stmt); note != "" {
				unread = append(unread, note)
			}

		case *nodes.DropStmt:
			if note := s.drop(stmt); note != "" {
				unread = append(unread, note)
			}

		case *nodes.AlterObjectSchemaStmt:
			if note := s.moveSchema(stmt); note != "" {
				unread = append(unread, note)
			}

		default:
			unread = append(unread, fmt.Sprintf("%T is not read", stmt))
		}
	}

	return unread, nil
}

func readRelation(stmt *nodes.CreateStmt) relation {
	r := relation{table: readTable(stmt), notNull: map[string]bool{}, constraints: map[string]constraintEffect{}}
	for _, elt := range items(stmt.TableElts) {
		switch def := elt.(type) {
		case *nodes.ColumnDef:
			r.notNull[def.Colname] = def.IsNotNull
			for _, held := range items(def.Constraints) {
				constraint, ok := held.(*nodes.Constraint)
				if !ok {
					continue
				}
				if constraint.Contype == nodes.CONSTR_NOTNULL || constraint.Contype == nodes.CONSTR_PRIMARY {
					r.notNull[def.Colname] = true
				}
				if constraint.Conname != "" {
					r.constraints[constraint.Conname] = constraintEffect{kind: constraint.Contype, columns: []string{def.Colname}}
				}
			}
		case *nodes.Constraint:
			r.applyConstraint(def)
		}
	}
	return r
}

func (s *ddlState) addRelation(r relation) {
	name := r.table.Name
	if at, exists := s.relationAt[name]; exists {
		s.relations[at] = r
		return
	}
	s.relationAt[name] = len(s.relations)
	s.relations = append(s.relations, r)
}

func (s *ddlState) addView(v declaredView) {
	if at, exists := s.viewAt[v.name]; exists {
		s.views[at] = v
		return
	}
	s.viewAt[v.name] = len(s.views)
	s.views = append(s.views, v)
}

func (s *ddlState) alter(stmt *nodes.AlterTableStmt) []string {
	if stmt.Relation == nil {
		return []string{"ALTER TABLE without a relation is not read"}
	}
	name := relationName(stmt.Relation)
	at, known := s.relationAt[name]
	if !known {
		return []string{fmt.Sprintf("ALTER TABLE refers to unknown table %q", name)}
	}
	r := &s.relations[at]
	var unread []string
	for _, item := range items(stmt.Cmds) {
		cmd, ok := item.(*nodes.AlterTableCmd)
		if !ok {
			unread = append(unread, fmt.Sprintf("ALTER TABLE subcommand %T is not read", item))
			continue
		}
		switch nodes.AlterTableType(cmd.Subtype) {
		case nodes.AT_AddColumn:
			def, ok := cmd.Def.(*nodes.ColumnDef)
			if !ok {
				unread = append(unread, fmt.Sprintf("ADD COLUMN %q has unsupported definition %T", cmd.Name, cmd.Def))
				continue
			}
			r.table.Columns = append(r.table.Columns, readColumn(def, false))
			r.notNull[def.Colname] = !r.table.Columns[len(r.table.Columns)-1].Nullable
			for _, held := range items(def.Constraints) {
				if constraint, ok := held.(*nodes.Constraint); ok && constraint.Conname != "" {
					r.constraints[constraint.Conname] = constraintEffect{kind: constraint.Contype, columns: []string{def.Colname}}
				}
			}
		case nodes.AT_DropColumn:
			r.dropColumn(cmd.Name)
		case nodes.AT_SetNotNull:
			if column := relationColumn(r, cmd.Name); column != nil {
				column.Nullable = false
				r.notNull[cmd.Name] = true
			} else {
				unread = append(unread, fmt.Sprintf("SET NOT NULL refers to unknown column %q", cmd.Name))
			}
		case nodes.AT_DropNotNull:
			if column := relationColumn(r, cmd.Name); column != nil {
				column.Nullable = !column.PK
				r.notNull[cmd.Name] = false
			} else {
				unread = append(unread, fmt.Sprintf("DROP NOT NULL refers to unknown column %q", cmd.Name))
			}
		case nodes.AT_AlterColumnType:
			def, ok := cmd.Def.(*nodes.ColumnDef)
			column := relationColumn(r, cmd.Name)
			if !ok || column == nil {
				unread = append(unread, fmt.Sprintf("ALTER COLUMN %q TYPE has unsupported definition %T", cmd.Name, cmd.Def))
				continue
			}
			column.Type = typeName(def.TypeName)
		case nodes.AT_AddConstraint:
			constraint, ok := cmd.Def.(*nodes.Constraint)
			if !ok || !r.applyConstraint(constraint) {
				unread = append(unread, fmt.Sprintf("ADD CONSTRAINT %q is not represented", cmd.Name))
			}
		case nodes.AT_DropConstraint:
			if !r.dropConstraint(cmd.Name) {
				unread = append(unread, fmt.Sprintf("DROP CONSTRAINT %q cannot be resolved", cmd.Name))
			}
		default:
			unread = append(unread, fmt.Sprintf("ALTER TABLE %q subcommand %d is not read", name, cmd.Subtype))
		}
	}
	return unread
}

func (r *relation) applyConstraint(c *nodes.Constraint) bool {
	columns := stringList(c.Keys)
	if c.Contype == nodes.CONSTR_FOREIGN {
		columns = stringList(c.FkAttrs)
	}
	switch c.Contype {
	case nodes.CONSTR_PRIMARY:
		for _, name := range columns {
			if column := relationColumn(r, name); column != nil {
				column.PK = true
				column.Nullable = false
			}
		}
	case nodes.CONSTR_FOREIGN:
		remote := stringList(c.PkAttrs)
		for i, name := range columns {
			if column := relationColumn(r, name); column != nil && c.Pktable != nil {
				column.FK = &catalog.FK{Table: relationName(c.Pktable), OnDelete: deleteAction(c.FkDelaction)}
				if i < len(remote) {
					column.FK.Column = remote[i]
				}
			}
		}
	case nodes.CONSTR_UNIQUE:
		r.indexes = append(r.indexes, catalog.TableIndex{Name: c.Conname, Columns: columns, Unique: true})
	default:
		return false
	}
	if c.Conname != "" {
		r.constraints[c.Conname] = constraintEffect{kind: c.Contype, columns: columns}
	}
	return true
}

func (r *relation) dropConstraint(name string) bool {
	effect, known := r.constraints[name]
	if !known {
		return false
	}
	for _, held := range effect.columns {
		if column := relationColumn(r, held); column != nil {
			switch effect.kind {
			case nodes.CONSTR_PRIMARY:
				column.PK = false
				column.Nullable = !r.notNull[held]
			case nodes.CONSTR_FOREIGN:
				column.FK = nil
			}
		}
	}
	if effect.kind == nodes.CONSTR_UNIQUE {
		indexes := r.indexes[:0]
		for _, index := range r.indexes {
			if index.Name != name {
				indexes = append(indexes, index)
			}
		}
		r.indexes = indexes
	}
	delete(r.constraints, name)
	return true
}

func (r *relation) dropColumn(name string) {
	for i := range r.table.Columns {
		if r.table.Columns[i].Name == name {
			r.table.Columns = append(r.table.Columns[:i], r.table.Columns[i+1:]...)
			break
		}
	}
	delete(r.notNull, name)
	indexes := r.indexes[:0]
	for _, index := range r.indexes {
		dropped := false
		for _, held := range index.Columns {
			if held == name {
				dropped = true
				break
			}
		}
		if !dropped {
			indexes = append(indexes, index)
		}
	}
	r.indexes = indexes
}

func relationColumn(r *relation, name string) *catalog.Column {
	for i := range r.table.Columns {
		if r.table.Columns[i].Name == name {
			return &r.table.Columns[i]
		}
	}
	return nil
}

func (s *ddlState) rename(stmt *nodes.RenameStmt) string {
	if stmt.RenameType == nodes.OBJECT_TYPE {
		parts, ok := stmt.Object.(*nodes.List)
		if !ok {
			return "RENAME TYPE without a qualified name is not read"
		}
		oldName := qualifiedName(stringList(parts))
		values, known := s.enums[oldName]
		if !known {
			return fmt.Sprintf("RENAME TYPE refers to unknown enum %q", oldName)
		}
		newName := qualifyLike(oldName, stmt.Newname)
		delete(s.enums, oldName)
		s.enums[newName] = values
		for i := range s.relations {
			for j := range s.relations[i].table.Columns {
				s.relations[i].table.Columns[j].Type = replaceBaseType(s.relations[i].table.Columns[j].Type, oldName, newName)
			}
		}
		return ""
	}
	if stmt.Relation == nil {
		return fmt.Sprintf("%T without a relation is not read", stmt)
	}
	oldTable := relationName(stmt.Relation)
	at, known := s.relationAt[oldTable]
	if !known {
		return fmt.Sprintf("RENAME refers to unknown table %q", oldTable)
	}
	if stmt.RenameType == nodes.OBJECT_COLUMN {
		r := &s.relations[at]
		column := relationColumn(r, stmt.Subname)
		if column == nil {
			return fmt.Sprintf("RENAME COLUMN refers to unknown column %q", stmt.Subname)
		}
		column.Name = stmt.Newname
		r.notNull[stmt.Newname] = r.notNull[stmt.Subname]
		delete(r.notNull, stmt.Subname)
		for i := range r.indexes {
			for j, name := range r.indexes[i].Columns {
				if name == stmt.Subname {
					r.indexes[i].Columns[j] = stmt.Newname
				}
			}
		}
		for i := range s.relations {
			for j := range s.relations[i].table.Columns {
				fk := s.relations[i].table.Columns[j].FK
				if fk != nil && fk.Table == oldTable && fk.Column == stmt.Subname {
					fk.Column = stmt.Newname
				}
			}
		}
		for i := range s.views {
			for j := range s.views[i].columns {
				for k, from := range s.views[i].columns[j].from {
					if from == oldTable+"."+stmt.Subname {
						s.views[i].columns[j].from[k] = oldTable + "." + stmt.Newname
					}
				}
			}
		}
		return ""
	}
	if stmt.RenameType != nodes.OBJECT_TABLE {
		return fmt.Sprintf("RENAME object type %d is not read", stmt.RenameType)
	}
	newTable := qualifyLike(oldTable, stmt.Newname)
	s.relations[at].table.Name = newTable
	delete(s.relationAt, oldTable)
	s.relationAt[newTable] = at
	s.renameRelationReferences(oldTable, newTable)
	return ""
}

func (s *ddlState) drop(stmt *nodes.DropStmt) string {
	names := objectNames(stmt.Objects)
	switch nodes.ObjectType(stmt.RemoveType) {
	case nodes.OBJECT_TABLE:
		for _, name := range names {
			s.removeRelation(name)
		}
	case nodes.OBJECT_VIEW, nodes.OBJECT_MATVIEW:
		for _, name := range names {
			s.removeView(name)
		}
	case nodes.OBJECT_INDEX:
		for _, name := range names {
			name = lastNamePart(name)
			for i := range s.relations {
				indexes := s.relations[i].indexes[:0]
				for _, index := range s.relations[i].indexes {
					if index.Name != name {
						indexes = append(indexes, index)
					}
				}
				s.relations[i].indexes = indexes
			}
		}
	case nodes.OBJECT_TYPE:
		for _, name := range names {
			delete(s.enums, name)
		}
	default:
		return fmt.Sprintf("DROP object type %d is not read", stmt.RemoveType)
	}
	return ""
}

func objectNames(list *nodes.List) []string {
	var out []string
	for _, item := range items(list) {
		parts, ok := item.(*nodes.List)
		if !ok {
			continue
		}
		name := qualifiedName(stringList(parts))
		if name != "" {
			out = append(out, name)
		}
	}
	return out
}

func (s *ddlState) removeRelation(name string) {
	at, known := s.relationAt[name]
	if !known {
		return
	}
	s.relations = append(s.relations[:at], s.relations[at+1:]...)
	s.reindexRelations()
}

func (s *ddlState) reindexRelations() {
	s.relationAt = map[string]int{}
	for i := range s.relations {
		s.relationAt[s.relations[i].table.Name] = i
	}
}

func (s *ddlState) removeView(name string) {
	at, known := s.viewAt[name]
	if !known {
		return
	}
	s.views = append(s.views[:at], s.views[at+1:]...)
	s.viewAt = map[string]int{}
	for i := range s.views {
		s.viewAt[s.views[i].name] = i
	}
}

func readTable(stmt *nodes.CreateStmt) catalog.Table {
	table := catalog.Table{Name: relationName(stmt.Relation), Columns: []catalog.Column{}}

	// A table constraint sits in the same list as the columns, so PRIMARY KEY
	// (a, b) is collected first and applied to the columns it names.
	keys := map[string]bool{}
	for _, elt := range items(stmt.TableElts) {
		constraint, ok := elt.(*nodes.Constraint)
		if !ok || constraint.Contype != nodes.CONSTR_PRIMARY {
			continue
		}
		for _, key := range stringList(constraint.Keys) {
			keys[key] = true
		}
	}

	for _, elt := range items(stmt.TableElts) {
		column, ok := elt.(*nodes.ColumnDef)
		if !ok {
			continue
		}
		table.Columns = append(table.Columns, readColumn(column, keys[column.Colname]))
	}

	return table
}

func readColumn(def *nodes.ColumnDef, tableKey bool) catalog.Column {
	column := catalog.Column{
		Name: def.Colname,
		Type: typeName(def.TypeName),
		PK:   tableKey,
	}

	notNull := def.IsNotNull
	for _, item := range items(def.Constraints) {
		constraint, ok := item.(*nodes.Constraint)
		if !ok {
			continue
		}

		switch constraint.Contype {
		case nodes.CONSTR_PRIMARY:
			column.PK = true
		case nodes.CONSTR_NOTNULL:
			notNull = true
		case nodes.CONSTR_FOREIGN:
			column.FK = readForeignKey(constraint)
		}
	}

	// A primary key is not null whether or not anybody wrote it down.
	column.Nullable = !notNull && !column.PK

	return column
}

func readForeignKey(constraint *nodes.Constraint) *catalog.FK {
	if constraint.Pktable == nil {
		return nil
	}

	fk := &catalog.FK{Table: relationName(constraint.Pktable), OnDelete: deleteAction(constraint.FkDelaction)}
	if referenced := stringList(constraint.PkAttrs); len(referenced) > 0 {
		fk.Column = referenced[0]
	}

	return fk
}

// deleteAction spells out the single character the grammar keeps. NO ACTION is
// the default and says nothing, so it is left off rather than written down.
func deleteAction(action byte) string {
	switch action {
	case 'r':
		return "restrict"
	case 'c':
		return "cascade"
	case 'n':
		return "set null"
	case 'd':
		return "set default"
	default:
		return ""
	}
}

func readIndex(stmt *nodes.IndexStmt) catalog.TableIndex {
	index := catalog.TableIndex{Name: stmt.Idxname, Unique: stmt.Unique, Columns: []string{}}

	for _, item := range items(stmt.IndexParams) {
		elem, ok := item.(*nodes.IndexElem)
		if !ok {
			continue
		}
		if elem.Name != "" {
			index.Columns = append(index.Columns, elem.Name)

			continue
		}
		// An index over an expression rather than a column. It has no column
		// name to give, and calling it one would be a lie.
		index.Columns = append(index.Columns, "(expression)")
	}

	return index
}

// typeName renders the type as the migration wrote it: `text`, `timestamptz`,
// `char(3)`. Never normalised - a reader comparing a column to the file it came
// from wants the string that is in the file.
func typeName(name *nodes.TypeName) string {
	if name == nil {
		return ""
	}

	parts := stringList(name.Names)
	// The grammar qualifies the types it knows; the qualification is noise to
	// anyone reading a schema.
	if len(parts) > 1 && parts[0] == "pg_catalog" {
		parts = parts[1:]
	}

	rendered := qualifiedName(parts)
	if spelled, ok := spelling[rendered]; ok {
		rendered = spelled
	}

	if mods := typeMods(name.Typmods); mods != "" {
		rendered += "(" + mods + ")"
	}
	for range items(name.ArrayBounds) {
		rendered += "[]"
	}

	return rendered
}

func relationName(relation *nodes.RangeVar) string {
	if relation == nil {
		return ""
	}
	if relation.Schemaname == "" || relation.Schemaname == "public" {
		return relation.Relname
	}
	return relation.Schemaname + "." + relation.Relname
}

func qualifiedName(parts []string) string {
	if len(parts) > 1 && parts[0] == "public" {
		parts = parts[1:]
	}
	return strings.Join(parts, ".")
}

func qualifyLike(oldName, newBase string) string {
	if at := strings.LastIndex(oldName, "."); at >= 0 {
		return oldName[:at+1] + newBase
	}
	return newBase
}

func replaceBaseType(held, oldName, newName string) string {
	base, arrays := arrayType(held)
	if base == oldName {
		return newName + arrays
	}
	return held
}

func (s *ddlState) renderType(held string) string {
	base, arrays := arrayType(held)
	values, ok := s.enums[base]
	if !ok {
		return held
	}
	return base + " enum(" + strings.Join(values, " | ") + ")" + arrays
}

func arrayType(held string) (string, string) {
	base := held
	arrays := ""
	for strings.HasSuffix(base, "[]") {
		base = strings.TrimSuffix(base, "[]")
		arrays += "[]"
	}
	return base, arrays
}

func (s *ddlState) alterEnum(stmt *nodes.AlterEnumStmt) string {
	name := qualifiedName(stringList(stmt.Typname))
	values, known := s.enums[name]
	if !known {
		return fmt.Sprintf("ALTER TYPE refers to unknown enum %q", name)
	}
	if stmt.Oldval != "" {
		for i, value := range values {
			if value == stmt.Oldval {
				values[i] = stmt.Newval
				s.enums[name] = values
				return ""
			}
		}
		return fmt.Sprintf("ALTER TYPE %q refers to unknown enum value %q", name, stmt.Oldval)
	}
	for _, value := range values {
		if value == stmt.Newval {
			if stmt.SkipIfNewvalExists {
				return ""
			}
			return fmt.Sprintf("ALTER TYPE %q adds duplicate enum value %q", name, stmt.Newval)
		}
	}
	at := len(values)
	if stmt.NewvalNeighbor != "" {
		at = -1
		for i, value := range values {
			if value == stmt.NewvalNeighbor {
				at = i
				if stmt.NewvalIsAfter {
					at++
				}
				break
			}
		}
		if at < 0 {
			return fmt.Sprintf("ALTER TYPE %q names unknown neighbor %q", name, stmt.NewvalNeighbor)
		}
	}
	values = append(values, "")
	copy(values[at+1:], values[at:])
	values[at] = stmt.Newval
	s.enums[name] = values
	return ""
}

func (s *ddlState) moveSchema(stmt *nodes.AlterObjectSchemaStmt) string {
	if stmt.ObjectType == nodes.OBJECT_TYPE {
		parts, ok := stmt.Object.(*nodes.List)
		if !ok {
			return "ALTER TYPE SET SCHEMA without a qualified name is not read"
		}
		oldName := qualifiedName(stringList(parts))
		values, known := s.enums[oldName]
		if !known {
			return fmt.Sprintf("ALTER TYPE SET SCHEMA refers to unknown enum %q", oldName)
		}
		newName := qualifyInSchema(stmt.Newschema, lastNamePart(oldName))
		delete(s.enums, oldName)
		s.enums[newName] = values
		for i := range s.relations {
			for j := range s.relations[i].table.Columns {
				s.relations[i].table.Columns[j].Type = replaceBaseType(s.relations[i].table.Columns[j].Type, oldName, newName)
			}
		}
		return ""
	}
	if stmt.Relation == nil {
		return "ALTER ... SET SCHEMA without a relation is not read"
	}
	oldName := relationName(stmt.Relation)
	if stmt.ObjectType != nodes.OBJECT_TABLE && stmt.ObjectType != nodes.OBJECT_VIEW && stmt.ObjectType != nodes.OBJECT_MATVIEW {
		return fmt.Sprintf("ALTER object type %d SET SCHEMA is not read", stmt.ObjectType)
	}
	newName := qualifyInSchema(stmt.Newschema, stmt.Relation.Relname)
	if at, known := s.relationAt[oldName]; known {
		s.relations[at].table.Name = newName
		delete(s.relationAt, oldName)
		s.relationAt[newName] = at
		s.renameRelationReferences(oldName, newName)
		return ""
	}
	if at, known := s.viewAt[oldName]; known {
		s.views[at].name = newName
		delete(s.viewAt, oldName)
		s.viewAt[newName] = at
		return ""
	}
	return fmt.Sprintf("ALTER SET SCHEMA refers to unknown relation %q", oldName)
}

func qualifyInSchema(schema, base string) string {
	if schema == "" || schema == "public" {
		return base
	}
	return schema + "." + base
}

func lastNamePart(name string) string {
	if at := strings.LastIndex(name, "."); at >= 0 {
		return name[at+1:]
	}
	return name
}

func (s *ddlState) renameRelationReferences(oldName, newName string) {
	for i := range s.relations {
		for j := range s.relations[i].table.Columns {
			if fk := s.relations[i].table.Columns[j].FK; fk != nil && fk.Table == oldName {
				fk.Table = newName
			}
		}
	}
	for i := range s.views {
		for j, read := range s.views[i].reads {
			if read == oldName {
				s.views[i].reads[j] = newName
			}
		}
		for j := range s.views[i].columns {
			for k, from := range s.views[i].columns[j].from {
				if strings.HasPrefix(from, oldName+".") {
					s.views[i].columns[j].from[k] = newName + strings.TrimPrefix(from, oldName)
				}
			}
		}
	}
}

// spelling puts back the words a migration was written with.
//
// The grammar normalises the standard type names to PostgreSQL's internal
// ones - `bigint` is parsed as `int8`, `boolean` as `bool` - and the catalog
// asks for the type as declared, because a reader comparing a column to the
// file it came from wants the string that is in the file.
//
// It is a table of the handful the grammar rewrites, not a normaliser of its
// own: a type this does not know passes through exactly as parsed. What it
// cannot do is tell a migration that wrote `int8` from one that wrote
// `bigint`, and it answers `bigint` for both.
var spelling = map[string]string{
	"int2":        "smallint",
	"int4":        "integer",
	"int8":        "bigint",
	"float4":      "real",
	"float8":      "double precision",
	"bool":        "boolean",
	"bpchar":      "char",
	"timestamp":   "timestamp",
	"timestamptz": "timestamptz",
}

// typeMods renders the length or precision a type was declared with.
//
// The grammar keeps them two ways - `char(3)` carries a bare integer, while
// `numeric(10,2)` wraps each one in a constant - so both are read. A modifier
// that is neither is left out rather than guessed at.
func typeMods(list *nodes.List) string {
	var mods []string

	for _, item := range items(list) {
		switch value := item.(type) {
		case *nodes.Integer:
			mods = append(mods, fmt.Sprint(value.Ival))
		case *nodes.A_Const:
			if inner, ok := value.Val.(*nodes.Integer); ok {
				mods = append(mods, fmt.Sprint(inner.Ival))
			}
		}
	}

	return strings.Join(mods, ",")
}

func items(list *nodes.List) []nodes.Node {
	if list == nil {
		return nil
	}

	return list.Items
}

// stringList pulls the string nodes out of a list, which is how the grammar
// keeps qualified names and key lists.
func stringList(list *nodes.List) []string {
	var out []string
	for _, item := range items(list) {
		if value, ok := item.(*nodes.String); ok {
			out = append(out, value.Str)
		}
	}

	return out
}
