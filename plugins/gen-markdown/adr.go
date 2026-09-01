package main

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

func (s *site) renderAdrs() {
	if len(s.cat.Adrs) == 0 {
		return
	}

	const self = "adr/README.md"

	var b strings.Builder
	b.WriteString("# Decision records\n\n")
	b.WriteString(s.stamp() + "\n")

	rows := make([][]string, 0, len(s.cat.Adrs))
	for i := range s.cat.Adrs {
		adr := &s.cat.Adrs[i]
		rows = append(rows, []string{
			s.ref(self, adr.ID, adr.ID),
			adr.Title,
			string(adr.Status),
			adr.Date,
			s.scopeRef(self, adr.Scope),
		})
	}
	b.WriteString(table([]string{"ADR", "Title", "Status", "Date", "Scope"}, rows))

	s.b.file(self, b.String())

	for i := range s.cat.Adrs {
		s.renderAdr(&s.cat.Adrs[i])
	}
}

func (s *site) renderAdr(adr *catalog.Adr) {
	self := s.pathOf[adr.ID]

	var b strings.Builder
	b.WriteString("# " + adr.ID + " — " + adr.Title + "\n\n")
	b.WriteString(s.stamp() + "\n")

	meta := [][]string{
		{"Status", string(adr.Status)},
		{"Date", adr.Date},
		{"Scope", s.scopeRef(self, adr.Scope)},
		{"Source", code(adr.Source)},
	}
	if adr.SupersededBy != "" {
		// Worth putting in the header rather than at the bottom: everything
		// below it is history the moment this is set.
		meta = append(meta, []string{"Superseded by", s.ref(self, adr.SupersededBy, adr.SupersededBy)})
	}
	if len(adr.Supersedes) > 0 {
		refs := make([]string, 0, len(adr.Supersedes))
		for _, id := range adr.Supersedes {
			refs = append(refs, s.ref(self, id, id))
		}
		meta = append(meta, []string{"Supersedes", strings.Join(refs, ", ")})
	}
	b.WriteString(defList(meta))

	// The body is the record. It is frozen history and is never regenerated
	// from the current catalog, so it goes in whole, one level down.
	if rendered := body(adr.Body, adr.Title); rendered != "" {
		b.WriteString("\n" + rendered + "\n")
	}

	section(&b, "Relates to", s.relatesList(self, adr.Relates))

	s.b.file(self, b.String())
}

func (s *site) relatesList(from string, relates catalog.AdrRelates) string {
	var b strings.Builder

	groups := []struct {
		label string
		ids   []string
	}{
		{"Services", relates.Services},
		{"Events", relates.Events},
		{"Flows", relates.Flows},
	}

	for _, group := range groups {
		if len(group.ids) == 0 {
			continue
		}

		refs := make([]string, 0, len(group.ids))
		for _, id := range group.ids {
			// An event id belongs to the aggregate page that publishes it, so
			// it is resolved through its owner rather than looked up directly.
			if page, ok := s.eventPage[id]; ok {
				refs = append(refs, s.ref(from, page, id))

				continue
			}
			refs = append(refs, s.ref(from, id, id))
		}
		b.WriteString("- **" + group.label + ":** " + strings.Join(refs, ", ") + "\n")
	}

	return b.String()
}

func (s *site) scopeRef(from string, scope catalog.AdrScope) string {
	switch scope.Kind {
	case "context":
		return s.ref(from, scope.Context, scope.Context)
	case "service":
		return s.ref(from, scope.Service, scope.Service)
	default:
		return "org"
	}
}
