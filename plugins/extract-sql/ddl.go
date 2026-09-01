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
	table   catalog.Table
	indexes []catalog.TableIndex
}

// readDDL turns one migration into the tables it creates, in the order it
// creates them.
func readDDL(sql, source string) ([]relation, []string, error) {
	tree, err := parser.Parse(sql)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", source, err)
	}

	var (
		out    []relation
		byName = map[string]int{}
		unread []string
	)

	for _, item := range tree.Items {
		switch stmt := item.(type) {
		case *nodes.CreateStmt:
			byName[stmt.Relation.Relname] = len(out)
			out = append(out, relation{table: readTable(stmt)})

		case *nodes.IndexStmt:
			at, known := byName[stmt.Relation.Relname]
			if !known {
				// An index on a table created by another migration is not a
				// mistake, but this reader builds a table from one file at a
				// time and would have nowhere to put it.
				unread = append(unread, fmt.Sprintf("index %q is on %q, which this file does not create", stmt.Idxname, stmt.Relation.Relname))

				continue
			}
			out[at].indexes = append(out[at].indexes, readIndex(stmt))

		default:
			unread = append(unread, fmt.Sprintf("%T is not read", stmt))
		}
	}

	return out, unread, nil
}

func readTable(stmt *nodes.CreateStmt) catalog.Table {
	table := catalog.Table{Name: stmt.Relation.Relname, Columns: []catalog.Column{}}

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

	fk := &catalog.FK{Table: constraint.Pktable.Relname, OnDelete: deleteAction(constraint.FkDelaction)}
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

	rendered := strings.Join(parts, ".")
	if spelled, ok := spelling[rendered]; ok {
		rendered = spelled
	}

	if mods := typeMods(name.Typmods); mods != "" {
		rendered += "(" + mods + ")"
	}

	return rendered
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
