package main

// Reading a view.
//
// A view is kept apart from a table rather than folded in behind a flag: it has
// no key, no constraints and no rows of its own, and what it has instead is
// what it reads. So this reads the select: which relations it draws from, what
// each output column is called, and - the part a table cannot say - which
// column each one was computed from.
//
// The type of a column is not in the statement, because a view does not declare
// one. It is taken from the column it is computed from when there is exactly
// one; a column summed, coalesced or joined out of several says nothing and is
// left blank rather than guessed at.

import (
	"strings"

	"github.com/pgplex/pgparser/nodes"

	"github.com/shortlink-org/portolan/catalog"
)

// view is what one CREATE VIEW says, before the store turns names into ids.
type view struct {
	name string
	doc  string
	// reads names the relations of the FROM clause, in the order written.
	reads []string
	// columns, in the order the select lists them.
	columns []viewColumn
	// definition is the statement as it was written.
	definition string
}

type viewColumn struct {
	name string
	// from is "<relation>.<column>" for every column this one is computed from.
	from []string
}

func readView(stmt *nodes.ViewStmt, sql string) view {
	out := view{name: stmt.View.Relname}

	query, ok := stmt.Query.(*nodes.SelectStmt)
	if !ok {
		return out
	}

	// alias -> relation, so `j.id` can be read as a column of journal_entries.
	relations := map[string]string{}
	readFrom(query.FromClause, relations, &out.reads)

	for _, item := range items(query.TargetList) {
		target, ok := item.(*nodes.ResTarget)
		if !ok {
			continue
		}

		var sources []string
		columnRefs(target.Val, relations, &sources)

		name := target.Name
		if name == "" && len(sources) == 1 {
			// `SELECT j.state` names its column after the column it takes.
			name = sources[0][strings.LastIndex(sources[0], ".")+1:]
		}
		if name == "" {
			continue
		}
		out.columns = append(out.columns, viewColumn{name: name, from: sources})
	}

	out.definition = definitionOf(sql, out.name)

	return out
}

// readFrom walks the FROM clause, which is a tree once anything is joined.
func readFrom(list *nodes.List, relations map[string]string, reads *[]string) {
	for _, item := range items(list) {
		readFromItem(item, relations, reads)
	}
}

func readFromItem(item nodes.Node, relations map[string]string, reads *[]string) {
	switch node := item.(type) {
	case *nodes.RangeVar:
		name := node.Relname
		relations[name] = name
		if node.Alias != nil && node.Alias.Aliasname != "" {
			relations[node.Alias.Aliasname] = name
		}
		*reads = append(*reads, name)

	case *nodes.JoinExpr:
		readFromItem(node.Larg, relations, reads)
		readFromItem(node.Rarg, relations, reads)
	}
}

// columnRefs collects every column an expression reaches, however deep: a sum
// of a coalesce of a column is still that column's value arriving here.
func columnRefs(node nodes.Node, relations map[string]string, into *[]string) {
	switch expression := node.(type) {
	case *nodes.ColumnRef:
		fields := stringList(expression.Fields)
		if len(fields) == 0 {
			return
		}
		column := fields[len(fields)-1]
		relation := ""
		if len(fields) > 1 {
			relation = relations[fields[len(fields)-2]]
		} else if len(relations) == 1 {
			for _, only := range relations {
				relation = only
			}
		}
		if relation == "" || column == "*" {
			return
		}
		*into = append(*into, relation+"."+column)

	case *nodes.FuncCall:
		for _, argument := range items(expression.Args) {
			columnRefs(argument, relations, into)
		}

	case *nodes.CoalesceExpr:
		for _, argument := range items(expression.Args) {
			columnRefs(argument, relations, into)
		}

	case *nodes.A_Expr:
		columnRefs(expression.Lexpr, relations, into)
		columnRefs(expression.Rexpr, relations, into)

	case *nodes.TypeCast:
		columnRefs(expression.Arg, relations, into)

	case *nodes.CaseExpr:
		columnRefs(expression.Arg, relations, into)
		for _, when := range items(expression.Args) {
			if clause, ok := when.(*nodes.CaseWhen); ok {
				columnRefs(clause.Expr, relations, into)
				columnRefs(clause.Result, relations, into)
			}
		}
		columnRefs(expression.Defresult, relations, into)
	}
}

// definitionOf cuts the statement out of the file it was read from.
//
// The parse tree is not printed back: a reader comparing the page to the
// migration wants the SQL somebody wrote, down to the line breaks they chose.
func definitionOf(sql, name string) string {
	lower := strings.ToLower(sql)
	at := strings.Index(lower, "create view "+strings.ToLower(name))
	if at < 0 {
		at = strings.Index(lower, "create or replace view "+strings.ToLower(name))
	}
	if at < 0 {
		return ""
	}
	end := strings.Index(sql[at:], ";")
	if end < 0 {
		return strings.TrimSpace(sql[at:])
	}

	return strings.TrimSpace(sql[at : at+end+1])
}

// asCatalog turns the names into ids, and takes what the statement does not
// say - a column's type, and whether it can be null - from the column it is
// computed from.
func (v view) asCatalog(storeID, source string, tables []catalog.Table) catalog.View {
	out := catalog.View{
		ID:         storeID + "." + v.name,
		Name:       v.name,
		Doc:        v.doc,
		Definition: v.definition,
		Source:     source,
	}
	for _, relation := range v.reads {
		out.Reads = append(out.Reads, storeID+"."+relation)
	}

	for _, column := range v.columns {
		held := catalog.Column{Name: column.name, Nullable: true}
		for _, from := range column.from {
			held.From = append(held.From, storeID+"."+from)
		}
		if len(column.from) == 1 {
			relation, name, _ := strings.Cut(column.from[0], ".")
			if source := columnOf(tables, storeID+"."+relation, name); source != nil {
				held.Type = source.Type
				held.Nullable = source.Nullable
				held.Maps = source.Maps
			}
		}
		out.Columns = append(out.Columns, held)
	}

	// What it holds is what the relation it is built on holds: a view over one
	// aggregate's tables is another way of reading that aggregate, and a view
	// that draws on several says nothing here rather than picking one.
	persists := ""
	for _, relation := range v.reads {
		table := tableOf(tables, storeID+"."+relation)
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
		out.Persists = &catalog.Persists{Aggregate: persists}
	}

	return out
}

func tableOf(tables []catalog.Table, id string) *catalog.Table {
	for i := range tables {
		if tables[i].ID == id {
			return &tables[i]
		}
	}

	return nil
}

func columnOf(tables []catalog.Table, tableID, name string) *catalog.Column {
	table := tableOf(tables, tableID)
	if table == nil {
		return nil
	}
	for i := range table.Columns {
		if table.Columns[i].Name == name {
			return &table.Columns[i]
		}
	}

	return nil
}
