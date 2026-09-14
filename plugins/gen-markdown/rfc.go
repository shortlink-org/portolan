package genmarkdown

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

func (s *site) renderRfcs() {
	if len(s.cat.Rfcs) == 0 {
		return
	}
	const self = "rfc/README.md"
	var b strings.Builder
	b.WriteString("# Requests for comments\n\n")
	b.WriteString(s.stamp() + "\n")
	rows := make([][]string, 0, len(s.cat.Rfcs))
	for i := range s.cat.Rfcs {
		rfc := &s.cat.Rfcs[i]
		activity := rfc.UpdatedAt
		if activity == "" {
			activity = rfc.CreatedAt
		}
		if len(activity) > 10 {
			activity = activity[:10]
		}
		rows = append(rows, []string{s.ref(self, rfc.ID, rfc.DisplayID), rfc.Title, rfc.Status, rfc.Lifecycle, activity, s.scopeRef(self, rfc.Scope)})
	}
	b.WriteString(table([]string{"RFC", "Title", "Source status", "Lifecycle", "Last activity", "Scope"}, rows))
	s.b.file(self, b.String())
	for i := range s.cat.Rfcs {
		s.renderRfc(&s.cat.Rfcs[i])
	}
}

func (s *site) renderRfc(rfc *catalog.Rfc) {
	self := s.pathOf[rfc.ID]
	var b strings.Builder
	b.WriteString("# " + rfc.DisplayID + " — " + rfc.Title + "\n\n")
	b.WriteString(s.stamp() + "\n")
	source := code(rfc.Source)
	if rfc.SourceKind == "file" {
		var owner *catalog.Service
		if rfc.Repository != "" {
			owner = &catalog.Service{Repo: rfc.Repository}
		}
		source = s.source(self, rfc.Source, owner)
	}
	meta := [][]string{{"Source status", rfc.Status}, {"Lifecycle", rfc.Lifecycle}, {"Scope", s.scopeRef(self, rfc.Scope)}, {"Source", source}}
	if rfc.Repository != "" {
		meta = append(meta, []string{"Repository", repoLink(rfc.Repository)})
	}
	if rfc.CreatedAt != "" {
		meta = append(meta, []string{"Created", rfc.CreatedAt})
	}
	if rfc.UpdatedAt != "" {
		meta = append(meta, []string{"Updated", rfc.UpdatedAt})
	}
	if len(rfc.Authors) > 0 {
		meta = append(meta, []string{"Authors", strings.Join(rfc.Authors, ", ")})
	}
	if len(rfc.Shepherds) > 0 {
		meta = append(meta, []string{"Shepherds", strings.Join(rfc.Shepherds, ", ")})
	}
	if rfc.Created != nil {
		meta = append(meta, []string{"Committed", commitLine(rfc.Created)})
	}
	if rfc.Revised != nil {
		meta = append(meta, []string{"Revised", commitLine(rfc.Revised)})
	}
	if rfc.DiscussionURL != "" {
		meta = append(meta, []string{"Discussion", "[open discussion](" + rfc.DiscussionURL + ")"})
	}
	b.WriteString(defList(meta))
	if rendered := body(rfc.Body, rfc.Title); rendered != "" {
		b.WriteString("\n" + rendered + "\n")
	}
	section(&b, "Affected architecture", s.relatesList(self, rfc.Relates))
	if len(rfc.Links) > 0 {
		var lines []string
		for _, record := range rfc.Links {
			lines = append(lines, "- **"+record.Relation+":** "+s.ref(self, record.ID, record.ID))
		}
		section(&b, "Related records", strings.Join(lines, "\n")+"\n")
	}
	s.b.file(self, b.String())
}
