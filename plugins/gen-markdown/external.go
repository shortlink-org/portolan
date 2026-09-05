package main

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// renderExternals writes one page per system outside the estate. The page
// says what the catalog may claim about it - what it answers on, read from
// the vendored copy of its document, and who of ours calls it - and nothing
// the estate would have to own the far end to know.
func (s *site) renderExternals() {
	for i := range s.cat.Externals {
		s.renderExternal(&s.cat.Externals[i])
	}
}

func (s *site) renderExternal(ext *catalog.External) {
	self := s.pathOf[ext.ID]

	var b strings.Builder
	b.WriteString("# " + orDefault(ext.Name, ext.ID) + "\n\n")
	b.WriteString(s.stamp() + "\n")

	rows := [][]string{
		{"Id", code(ext.ID)},
		{"Where", "outside the estate"},
	}
	if ext.URL != "" {
		rows = append(rows, []string{"Documented at", "<" + ext.URL + ">"})
	}
	b.WriteString(defList(rows))

	if ext.Summary != "" {
		b.WriteString("\n" + ext.Summary + "\n")
	}

	section(&b, "Provides", s.providesBlock(self, ext.Provides))
	section(&b, "Called by", s.calledByTable(self, ext.ID))

	s.b.file(self, b.String())
}

// calledByTable is every call in the catalog that lands on the external. The
// service pages list their own calls outward; this is the one place the
// callers of a third party stand together.
func (s *site) calledByTable(from, externalID string) string {
	var rows [][]string
	for i := range s.cat.Contexts {
		ctx := &s.cat.Contexts[i]
		for j := range ctx.Services {
			svc := &ctx.Services[j]
			for k := range svc.Consumes {
				call := &svc.Consumes[k]
				if call.Peer != externalID {
					continue
				}
				rows = append(rows, []string{
					s.ref(from, svc.ID, svc.Name),
					code(call.ID),
					string(call.Status),
					code(call.Source),
				})
			}
		}
	}

	return table([]string{"Service", "Call", "Status", "Source"}, rows)
}
