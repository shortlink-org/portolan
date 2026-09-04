package main

// Where a column's value came from, when it came from somewhere else.
//
// A view says this in its own select and needs no help. A table cannot: a
// column copied from another service's row - the address the warehouse keeps
// beside the order it belongs to - is a copy made by code, and the migration
// that creates the column is the only place the fact can be written down where
// it will be read.
//
// So it is declared, in the one form a migration already has for saying
// something to a person:
//
//	-- from: shop.oms.pg.orders.ship_to
//	ship_to text NOT NULL,
//
// The grammar drops comments, so this is read off the text. A line naming a
// column of this store may leave the store out - `orders.ship_to` - and the
// store's own id is put back on; anything else is taken as written, which is
// how a copy from another service's schema is spelled.

import (
	"regexp"
	"strings"
)

var (
	createTable = regexp.MustCompile(`(?i)^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?"?([\w.]+)"?`)
	fromComment = regexp.MustCompile(`(?i)^\s*--\s*from:\s*(.+?)\s*$`)
	columnLine  = regexp.MustCompile(`^\s*"?(\w+)"?\s+\S`)
)

// readCopies reads the `-- from:` lines of one migration, as table -> column ->
// the ids the value was copied from.
func readCopies(sql, storeID string) map[string]map[string][]string {
	out := map[string]map[string][]string{}

	table := ""
	var pending []string

	for _, line := range strings.Split(sql, "\n") {
		if found := createTable.FindStringSubmatch(line); found != nil {
			table = unqualified(found[1])
			pending = nil

			continue
		}
		if strings.HasPrefix(strings.TrimSpace(line), ")") {
			table = ""
			pending = nil

			continue
		}
		if found := fromComment.FindStringSubmatch(line); found != nil {
			for _, id := range strings.Split(found[1], ",") {
				id = strings.TrimSpace(id)
				if id == "" {
					continue
				}
				// A column of this store may be named without it.
				if strings.Count(id, ".") == 1 {
					id = storeID + "." + id
				}
				pending = append(pending, id)
			}

			continue
		}
		if table == "" || len(pending) == 0 {
			continue
		}
		if found := columnLine.FindStringSubmatch(line); found != nil {
			column := strings.ToLower(found[1])
			if isConstraintWord(column) {
				pending = nil

				continue
			}
			if out[table] == nil {
				out[table] = map[string][]string{}
			}
			out[table][column] = pending
			pending = nil
		}
	}

	return out
}

// isConstraintWord tells a column definition from the table-level clauses that
// look like one.
func isConstraintWord(word string) bool {
	switch word {
	case "primary", "unique", "foreign", "constraint", "check", "exclude", "like":
		return true
	}

	return false
}

func unqualified(name string) string {
	if at := strings.LastIndex(name, "."); at >= 0 {
		return name[at+1:]
	}

	return name
}
