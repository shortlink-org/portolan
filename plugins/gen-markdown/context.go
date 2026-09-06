package main

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

func (s *site) renderContext(ctx *catalog.BoundedContext) {
	self := s.pathOf[ctx.ID]

	var b strings.Builder
	b.WriteString("# " + ctx.Name + "\n\n")
	b.WriteString(s.stamp() + "\n")

	meta := [][]string{{"Id", code(ctx.ID)}}
	if ctx.Kind != "" {
		meta = append(meta, []string{"Kind", string(ctx.Kind)})
	}
	if ctx.Classification != "" {
		meta = append(meta, []string{"Classification", string(ctx.Classification)})
	}
	b.WriteString(defList(meta))

	if ctx.Summary != "" {
		b.WriteString("\n" + ctx.Summary + "\n")
	}

	neutral := ctx.Kind != "" && ctx.Kind != catalog.GroupKindBoundedContext
	rows := make([][]string, 0, len(ctx.Services))
	for i := range ctx.Services {
		svc := &ctx.Services[i]
		if neutral {
			rows = append(rows, []string{
				s.ref(self, svc.ID, svc.Name),
				string(svc.Kind),
				strings.Join(svc.Technologies, ", "),
				code(svc.Path),
			})
			continue
		}
		aggregates := make([]string, 0, len(svc.Aggregates))
		for j := range svc.Aggregates {
			aggregates = append(aggregates, svc.Aggregates[j].Name)
		}
		rows = append(rows, []string{
			s.ref(self, svc.ID, svc.Name),
			code(svc.Path),
			strings.Join(aggregates, ", "),
		})
	}
	title := "Services"
	firstColumn := "Service"
	headings := []string{firstColumn, "Path", "Aggregates"}
	if neutral {
		title = "Components"
		firstColumn = "Component"
		headings = []string{firstColumn, "Kind", "Technologies", "Path"}
	}
	section(&b, title, table(headings, rows))

	// Before the decisions, because the decisions are written in these words.
	if terms := s.termsOf[ctx.ID]; len(terms) > 0 {
		section(&b, "Language", "- "+link("Glossary", self, s.glossaryPath(ctx))+
			" — "+plural(len(terms), "term")+" this context spells one way\n")
	}

	section(&b, "Decisions", s.adrTable(self, s.adrsFor[ctx.ID]))

	s.b.file(self, b.String())
	s.renderGlossary(ctx)

	for i := range ctx.Services {
		s.renderService(ctx, &ctx.Services[i])
	}
}

func (s *site) adrTable(from string, adrs []*catalog.Adr) string {
	rows := make([][]string, 0, len(adrs))
	for _, adr := range adrs {
		rows = append(rows, []string{
			s.ref(from, adr.ID, adr.ID),
			adr.Title,
			string(adr.Status),
			adr.Date,
		})
	}

	return table([]string{"ADR", "Title", "Status", "Date"}, rows)
}
