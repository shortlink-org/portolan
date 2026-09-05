package main

// Whose rows a projection is a picture of, when the migration says.
//
// A repository package names its aggregate by where it sits: the directory is
// the aggregate, and the first table it creates is the root. A projector
// package cannot say it that way. The projection is named after the question
// it answers, not after an aggregate, and the aggregate it is built from may
// belong to another service whose name appears nowhere in this tree.
//
// So it is declared, in the same form a copied column already uses, above the
// CREATE TABLE it speaks for:
//
//	-- Planned stops, rebuilt from RoutePlanned.
//	-- aggregate: shop.oms.order
//	CREATE TABLE route_stops (
//
// A bare slug (`route`) is an aggregate of the service that owns the store and
// is spelled the way the repository layout would spell it: `price_list` is
// `price-list`. Anything with a dot in it is a full id and is taken as
// written. Other comment lines may sit between the note and the statement; a
// statement may not, and a note that reaches nothing is dropped.

import (
	"regexp"
	"strings"
)

var aggregateComment = regexp.MustCompile(`(?i)^\s*--\s*aggregate:\s*(.+?)\s*$`)

// readProjected reads the `-- aggregate:` lines of one migration, as
// unqualified table name -> aggregate id.
func readProjected(sql, owner string) map[string]string {
	out := map[string]string{}
	pending := ""

	for _, line := range strings.Split(sql, "\n") {
		if found := aggregateComment.FindStringSubmatch(line); found != nil {
			pending = aggregateID(found[1], owner)

			continue
		}
		if found := createTable.FindStringSubmatch(line); found != nil {
			if pending != "" {
				out[unqualified(found[1])] = pending
			}
			pending = ""

			continue
		}
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}
		// Anything else is a statement, and the note was not about it.
		pending = ""
	}

	return out
}

// aggregateID spells the note as an id: a bare slug belongs to the owner of the
// store, a dotted name is already one.
func aggregateID(note, owner string) string {
	if strings.Contains(note, ".") {
		return note
	}

	return owner + "." + slug(note)
}
