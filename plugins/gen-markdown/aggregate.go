package main

import (
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

func (s *site) renderAggregate(svc *catalog.Service, agg *catalog.Aggregate) {
	self := s.pathOf[agg.ID]

	var b strings.Builder
	b.WriteString("# " + agg.Name + "\n\n")
	b.WriteString(s.stamp() + "\n")

	b.WriteString(defList([][]string{
		{"Id", code(agg.ID)},
		{"Service", s.ref(self, svc.ID, svc.Name)},
		{"Root", code(agg.Root)},
	}))

	if readme := body(agg.Readme, agg.Name); readme != "" {
		b.WriteString("\n" + readme + "\n")
	}

	if !hasBlock(agg.Entities, agg.Root) {
		s.b.warn(agg.ID, "aggregate %q names %q as its root, which is not one of its entities", agg.ID, agg.Root)
	}

	section(&b, "Entities", s.blocks(self, agg.Entities, agg.Root))
	section(&b, "Value objects", s.blocks(self, agg.ValueObjects, ""))
	section(&b, "Operations", s.operationsTable(agg))
	section(&b, "Events", s.eventsBlock(self, agg))

	s.b.file(self, b.String())
}

func hasBlock(blocks []catalog.Block, name string) bool {
	for i := range blocks {
		if blocks[i].Name == name {
			return true
		}
	}

	return false
}

// blocks renders entities or value objects. A block is either a shape of its
// own or a name for a shared one; both are shown with their fields, because a
// reader asking what a value object holds should not have to follow a link to
// find out.
func (s *site) blocks(from string, blocks []catalog.Block, root string) string {
	var b strings.Builder

	for i := range blocks {
		block := &blocks[i]

		heading := block.Name
		if block.Name == root {
			heading += " — aggregate root"
		}
		b.WriteString("### " + heading + "\n\n")

		if block.Doc != "" {
			b.WriteString(block.Doc + "\n\n")
		}

		fields := block.Fields
		if block.Ref != "" {
			def, ok := s.cat.Defs[block.Ref]
			if !ok {
				s.b.warn(block.ID, "%q refers to shared type %q, which this catalog does not define", block.ID, block.Ref)
			} else {
				fields = def.Fields
			}
			b.WriteString("Shared type " + s.defRef(from, block.Ref) + ".\n\n")
		}

		if rendered := s.fieldTable(from, fields); rendered != "" {
			b.WriteString(rendered + "\n")
		}
	}

	return b.String()
}

func (s *site) operationsTable(agg *catalog.Aggregate) string {
	// Whether this service records what exposes an operation at all. A catalog
	// written before anything read a transport layer says nothing either way,
	// and printing "internal" from that silence would be inventing.
	recorded := false
	for i := range agg.Operations {
		if len(agg.Operations[i].ExposedBy) > 0 {
			recorded = true

			break
		}
	}

	rows := make([][]string, 0, len(agg.Operations))
	for i := range agg.Operations {
		op := &agg.Operations[i]

		exposed := ""
		switch {
		case len(op.ExposedBy) > 0:
			methods := make([]string, 0, len(op.ExposedBy))
			for _, method := range op.ExposedBy {
				methods = append(methods, code(method))
			}
			exposed = strings.Join(methods, ", ")
		case recorded:
			exposed = "*internal*"
		}

		rows = append(rows, []string{code(op.ID), string(op.Kind), exposed, op.Doc})
	}

	return table([]string{"Operation", "Kind", "Exposed by", "Doc"}, rows)
}

// eventsBlock renders every version of every event, oldest first.
//
// Older versions are kept rather than collapsed into the latest: a consumer
// reading this page is very often the one still on v1, and a page that shows
// only what the publisher sends today cannot answer their question.
func (s *site) eventsBlock(from string, agg *catalog.Aggregate) string {
	var b strings.Builder

	for i := range agg.Events {
		event := &agg.Events[i]
		b.WriteString("### " + event.Name + "\n\n")
		b.WriteString(code(event.ID) + "\n")

		if len(event.Versions) == 0 {
			s.b.warn(event.ID, "event %q has no versions", event.ID)
		}

		consumers := make([][]string, 0, len(event.Consumers))
		for _, consumer := range event.Consumers {
			consumers = append(consumers, []string{
				s.ref(from, consumer.Service, consumer.Service),
				string(consumer.Status),
				consumer.Note,
			})
		}
		if rendered := table([]string{"Consumer", "Status", "Note"}, consumers); rendered != "" {
			b.WriteString("\n" + rendered)
		}

		for j := range event.Versions {
			version := &event.Versions[j]

			label := version.Version
			if j == len(event.Versions)-1 {
				label += " — current"
			}
			b.WriteString("\n#### " + label + "\n\n")

			if version.Doc != "" {
				b.WriteString(version.Doc + "\n\n")
			}
			if version.Source != "" {
				b.WriteString("Source: " + code(version.Source) + "\n\n")
			}
			b.WriteString(s.fieldTable(from, version.Fields))
		}
		b.WriteString("\n")
	}

	return b.String()
}

func (s *site) fieldTable(from string, fields []catalog.Field) string {
	rows := make([][]string, 0, len(fields))
	for i := range fields {
		field := &fields[i]

		typ := code(field.Type)
		if field.Ref != "" {
			typ = s.defRef(from, field.Ref)
		}
		rows = append(rows, []string{code(field.Name), typ, field.Doc})
	}

	return table([]string{"Field", "Type", "Doc"}, rows)
}

// defRef links a shared type to its entry on the types page. Shared types have
// no page of their own: what a reader wants from `Money` is the same six lines
// wherever it is mentioned, and six lines do not deserve twenty files.
func (s *site) defRef(from, key string) string {
	if _, ok := s.cat.Defs[key]; !ok {
		return code(key)
	}

	return "[" + code(key) + "](" + rel(from, typesPage) + "#" + anchor(key) + ")"
}

const typesPage = "types.md"

// anchor is a GitHub-flavoured heading anchor: lowercased, spaces to dashes,
// everything else dropped.
func anchor(heading string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(heading) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('-')
		}
	}

	return b.String()
}

func (s *site) renderTypes() {
	if len(s.cat.Defs) == 0 {
		return
	}

	var b strings.Builder
	b.WriteString("# Shared types\n\n")
	b.WriteString(s.stamp() + "\n")
	b.WriteString("Types named by more than one aggregate, event or message. A field that\n")
	b.WriteString("refers to one of these is knowably the same shape everywhere it appears.\n")

	for _, key := range sortedDefKeys(s.cat.Defs) {
		def := s.cat.Defs[key]
		b.WriteString("\n## " + key + "\n\n")
		b.WriteString(s.fieldTable(typesPage, def.Fields))
	}

	s.b.file(typesPage, b.String())
}

func plural(n int, word string, irregular ...string) string {
	if n == 1 {
		return "1 " + word
	}
	if len(irregular) > 0 {
		return strconv.Itoa(n) + " " + irregular[0]
	}

	return strconv.Itoa(n) + " " + word + "s"
}
