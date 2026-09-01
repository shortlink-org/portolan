package main

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

func (s *site) renderStore(store *catalog.Store) {
	self := s.pathOf[store.ID]

	var b strings.Builder
	b.WriteString("# " + store.Name + "\n\n")
	b.WriteString(s.stamp() + "\n")

	meta := [][]string{
		{"Id", code(store.ID)},
		{"Kind", string(store.Kind)},
		{"Owner", s.ref(self, store.Owner, store.Owner)},
	}
	if store.Source != "" {
		meta = append(meta, []string{"Source", code(store.Source)})
	}
	b.WriteString(defList(meta))

	var tables strings.Builder
	for i := range store.Tables {
		s.renderTable(&tables, self, store, &store.Tables[i])
	}
	section(&b, "Tables", tables.String())

	var views strings.Builder
	for i := range store.Views {
		s.renderView(&views, self, store, &store.Views[i])
	}
	section(&b, "Views", views.String())

	s.b.file(self, b.String())
}

func (s *site) renderTable(b *strings.Builder, self string, store *catalog.Store, tbl *catalog.Table) {
	b.WriteString("### " + tbl.Name + "\n\n")

	meta := []string{}
	if tbl.Role != "" {
		meta = append(meta, string(tbl.Role))
	}
	if tbl.Persists != nil {
		if tbl.Persists.Aggregate != "" {
			meta = append(meta, "persists "+s.ref(self, tbl.Persists.Aggregate, tbl.Persists.Aggregate))
		}
		if tbl.Persists.Block != "" {
			meta = append(meta, "block "+code(tbl.Persists.Block))
		}
	}
	if len(meta) > 0 {
		b.WriteString(strings.Join(meta, " · ") + "\n\n")
	}
	if tbl.Doc != "" {
		b.WriteString(tbl.Doc + "\n\n")
	}

	b.WriteString(s.columnTable(self, store, tbl.Columns))

	indexes := make([][]string, 0, len(tbl.Indexes))
	for _, idx := range tbl.Indexes {
		kind := "index"
		if idx.Unique {
			kind = "unique"
		}
		indexes = append(indexes, []string{code(idx.Name), strings.Join(idx.Columns, ", "), kind})
	}
	if rendered := table([]string{"Index", "Columns", "Kind"}, indexes); rendered != "" {
		b.WriteString("\n" + rendered)
	}
	b.WriteString("\n")
}

func (s *site) renderView(b *strings.Builder, self string, store *catalog.Store, view *catalog.View) {
	b.WriteString("### " + view.Name + "\n\n")

	meta := []string{}
	if view.Materialized {
		// Worth saying first and plainly: a materialised view can be stale, and
		// that is the one thing a reader has to know before believing a row.
		meta = append(meta, "**materialized** — rows are stored, and can be stale")
	} else {
		meta = append(meta, "computed on read")
	}
	if len(view.Reads) > 0 {
		reads := make([]string, 0, len(view.Reads))
		for _, id := range view.Reads {
			reads = append(reads, s.relationRef(self, id))
		}
		meta = append(meta, "reads "+strings.Join(reads, ", "))
	}
	b.WriteString(strings.Join(meta, " · ") + "\n\n")

	if view.Doc != "" {
		b.WriteString(view.Doc + "\n\n")
	}

	b.WriteString(s.columnTable(self, store, view.Columns))

	if view.Definition != "" {
		b.WriteString("\n" + fence("sql", view.Definition))
	}
	if view.Source != "" {
		b.WriteString("\nSource: " + code(view.Source) + "\n")
	}
	b.WriteString("\n")
}

func (s *site) columnTable(self string, store *catalog.Store, columns []catalog.Column) string {
	rows := make([][]string, 0, len(columns))
	for i := range columns {
		col := &columns[i]

		key := ""
		switch {
		case col.PK:
			key = "PK"
		case col.FK != nil:
			key = "→ " + s.relationRef(self, col.FK.Table) + "." + col.FK.Column
			if col.FK.OnDelete != "" {
				key += " (" + col.FK.OnDelete + ")"
			}
		}

		null := "not null"
		if col.Nullable {
			null = "null"
		}

		from := ""
		if len(col.From) > 0 {
			sources := make([]string, 0, len(col.From))
			for _, ref := range col.From {
				sources = append(sources, code(ref))

				// Lineage that leaves the store is how a service stays out of
				// somebody else's database - and nothing on the far side records
				// that the copy exists.
				if owner, ok := s.relationStore[relationOf(ref)]; ok && owner != store.ID {
					s.b.warn(store.ID, "%s.%s is copied from %q, which lives in store %q", store.ID, col.Name, ref, owner)
				}
			}
			from = strings.Join(sources, ", ")
		}

		rows = append(rows, []string{code(col.Name), code(col.Type), null, key, col.Maps, from, col.Doc})
	}

	return table([]string{"Column", "Type", "Null", "Key", "Maps", "From", "Doc"}, rows)
}

// relationRef links a table or view id to the heading that documents it,
// wherever that lives - a foreign key routinely points at a table in another
// store, and the point of the link is to say so.
func (s *site) relationRef(from, id string) string {
	storeID, known := s.relationStore[id]
	if !known {
		return code(id)
	}

	page, ok := s.pathOf[storeID]
	if !ok {
		return code(id)
	}

	return "[" + code(id) + "](" + rel(from, page) + "#" + anchor(s.relationName[id]) + ")"
}

// relationOf strips the trailing column from a lineage reference,
// "<table or view id>.<column>", leaving the relation.
func relationOf(ref string) string {
	if i := strings.LastIndex(ref, "."); i >= 0 {
		return ref[:i]
	}

	return ref
}
