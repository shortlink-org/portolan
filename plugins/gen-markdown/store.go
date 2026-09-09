package genmarkdown

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
		meta = append(meta, []string{"Source", s.source(self, store.Source, s.services[store.Owner])})
	}
	b.WriteString(defList(meta))

	keyspaces := make([][]string, 0, len(store.Keyspaces))
	for i := range store.Keyspaces {
		keyspace := &store.Keyspaces[i]
		source := ""
		if keyspace.Source != "" {
			source = s.source(self, keyspace.Source, s.services[store.Owner])
		}
		operations := make([]string, 0, len(keyspace.Operations))
		for _, operation := range keyspace.Operations {
			operations = append(operations, string(operation))
		}
		aggregate := ""
		if keyspace.Persists != nil && keyspace.Persists.Aggregate != "" {
			aggregate = s.ref(self, keyspace.Persists.Aggregate, keyspace.Persists.Aggregate)
		}
		keyspaces = append(keyspaces, []string{
			code(keyspace.Pattern), strings.Join(operations, ", "), code(keyspace.Value), code(keyspace.TTL), aggregate, source,
		})
	}
	section(&b, "Redis key patterns", table([]string{"Pattern", "Operations", "Value", "TTL", "Aggregate", "Source"}, keyspaces))

	accesses := [][]string{}
	for i := range store.Keyspaces {
		keyspace := &store.Keyspaces[i]
		for j := range keyspace.Accesses {
			access := &keyspace.Accesses[j]
			source := ""
			if access.Source != "" {
				source = s.source(self, access.Source, s.services[store.Owner])
			}
			accesses = append(accesses, []string{
				code(keyspace.Pattern), string(access.Operation), code(access.Method), code(access.Value), code(access.TTL), source,
			})
		}
	}
	section(&b, "Redis accesses", table([]string{"Pattern", "Operation", "Method", "Value", "TTL", "Source"}, accesses))

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
	b.WriteString("<a id=\"relation-" + anchorID(tbl.ID) + "\"></a>\n")
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

	accesses := make([][]string, 0, len(tbl.Accesses))
	for i := range tbl.Accesses {
		access := &tbl.Accesses[i]
		source := ""
		if access.Source != "" {
			source = s.source(self, access.Source, s.services[store.Owner])
		}
		accesses = append(accesses, []string{string(access.Operation), code(access.Method), source})
	}
	if rendered := table([]string{"Access", "Method", "Source"}, accesses); rendered != "" {
		b.WriteString(rendered + "\n")
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
	b.WriteString("<a id=\"relation-" + anchorID(view.ID) + "\"></a>\n")
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
		b.WriteString("\nSource: " + s.source(self, view.Source, s.services[store.Owner]) + "\n")
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

	return "[" + code(id) + "](" + rel(from, page) + "#relation-" + anchorID(id) + ")"
}

// relationOf strips the trailing column from a lineage reference,
// "<table or view id>.<column>", leaving the relation.
func relationOf(ref string) string {
	if i := strings.LastIndex(ref, "."); i >= 0 {
		return ref[:i]
	}

	return ref
}
