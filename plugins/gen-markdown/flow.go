package main

import (
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

func (s *site) renderFlows() {
	if len(s.cat.Flows) == 0 {
		return
	}

	const self = "flows/README.md"

	var b strings.Builder
	b.WriteString("# Flows\n\n")
	b.WriteString(s.stamp() + "\n")

	rows := make([][]string, 0, len(s.cat.Flows))
	for i := range s.cat.Flows {
		flow := &s.cat.Flows[i]
		owner := "—"
		if flow.Owner != "" {
			owner = s.ref(self, flow.Owner, flow.Owner)
		}
		rows = append(rows, []string{
			s.ref(self, flow.ID, flow.Name),
			string(flow.Provenance),
			owner,
			firstLine(flow.Summary),
		})
	}
	b.WriteString(table([]string{"Flow", "Provenance", "Owner", "Summary"}, rows))

	s.b.file(self, b.String())

	for i := range s.cat.Flows {
		s.renderFlow(&s.cat.Flows[i])
	}
}

func (s *site) renderFlow(flow *catalog.Flow) {
	self := s.pathOf[flow.ID]

	// Participants are aliased before anything is drawn. Mermaid takes an
	// identifier where the catalog has a dotted service id, and the alias is
	// also what the step list uses, so both readings name the lanes the same.
	alias := make(map[string]string, len(flow.Participants))
	for i := range flow.Participants {
		alias[flow.Participants[i].ID] = "p" + strconv.Itoa(i)
	}

	var b strings.Builder
	b.WriteString("# " + flow.Name + "\n\n")
	b.WriteString(s.stamp() + "\n")

	meta := [][]string{
		{"Id", code(flow.ID)},
		// Provenance is the first thing a reader needs: a flow reconstructed
		// from an integration test is a different kind of claim from one
		// somebody wrote down.
		{"Provenance", string(flow.Provenance)},
	}
	if flow.Owner != "" {
		meta = append(meta, []string{"Owner", s.ref(self, flow.Owner, flow.Owner)})
	}
	if flow.Source != "" {
		meta = append(meta, []string{"Source", code(flow.Source)})
	}
	if flow.VerifiedAt != "" {
		meta = append(meta, []string{"Verified", flow.VerifiedAt})
	}
	b.WriteString(defList(meta))

	if flow.Summary != "" {
		b.WriteString("\n" + flow.Summary + "\n")
	}

	participants := make([][]string, 0, len(flow.Participants))
	for i := range flow.Participants {
		p := &flow.Participants[i]
		context := "—"
		if p.Context != nil {
			context = s.ref(self, *p.Context, *p.Context)
		}
		participants = append(participants, []string{code(p.ID), string(p.Kind), context, p.Label})
	}
	section(&b, "Participants", table([]string{"Participant", "Kind", "Context", "Label"}, participants))

	section(&b, "Sequence", fence("mermaid", s.mermaid(flow, alias)))

	counter := 0
	section(&b, "Steps", s.stepList(self, flow, flow.Steps, &counter))

	s.b.file(self, b.String())
}

func (s *site) mermaid(flow *catalog.Flow, alias map[string]string) string {
	var b strings.Builder
	b.WriteString("sequenceDiagram\n")
	// autonumber so the diagram and the step list below carry the same numbers.
	b.WriteString("    autonumber\n")

	for i := range flow.Participants {
		p := &flow.Participants[i]

		keyword := "participant"
		if p.Kind == catalog.ParticipantActor {
			keyword = "actor"
		}

		label := p.Label
		if label == "" {
			label = p.ID
		}
		b.WriteString("    " + keyword + " " + alias[p.ID] + " as " + mermaidText(label) + "\n")
	}

	s.mermaidNodes(&b, flow.Steps, alias, 1)

	return b.String()
}

func (s *site) mermaidNodes(b *strings.Builder, nodes catalog.FlowNodes, alias map[string]string, depth int) {
	indent := strings.Repeat("    ", depth)

	for _, node := range nodes {
		switch n := node.(type) {
		case *catalog.Step:
			// An event is drawn with the async arrow. A reader who cannot tell
			// a call from a publication is reading a different flow.
			arrow := "->>"
			if n.Kind == catalog.StepEvent {
				arrow = "-)"
			}
			b.WriteString(indent + alias[n.From] + arrow + alias[n.To] + ": " + mermaidText(stepLabel(n)) + "\n")

		case *catalog.Parallel:
			b.WriteString(indent + "par " + mermaidText(orDefault(n.Title, "in parallel")) + "\n")
			for i, branch := range n.Branches {
				if i > 0 {
					b.WriteString(indent + "and\n")
				}
				s.mermaidNodes(b, branch, alias, depth+1)
			}
			b.WriteString(indent + "end\n")

		case *catalog.Alt:
			for i, branch := range n.Branches {
				keyword := "else "
				if i == 0 {
					keyword = "alt "
				}
				b.WriteString(indent + keyword + mermaidText(branch.Title) + "\n")
				s.mermaidNodes(b, branch.Steps, alias, depth+1)

				// A branch that ends the flow has to say so inside the diagram.
				// Without it the steps drawn after the alt read as if they
				// follow this branch too.
				if branch.Terminal {
					if last := lastParticipant(branch.Steps); last != "" {
						b.WriteString(strings.Repeat("    ", depth+1) + "Note over " + alias[last] + ": flow ends here\n")
					}
				}
			}
			b.WriteString(indent + "end\n")

		case *catalog.Loop:
			b.WriteString(indent + "loop " + mermaidText(n.Title) + "\n")
			s.mermaidNodes(b, n.Steps, alias, depth+1)
			b.WriteString(indent + "end\n")
		}
	}
}

// stepList is the same walk again, in prose. The diagram shows the shape and
// the list carries what will not fit on an arrow: where the step was read
// from, how far it is trusted, and what it refers to.
//
// Branches are wrapped in block quotes rather than indented. Four spaces of
// indentation is a code block in markdown, and three is a continuation of
// whatever list came before - a quote is the one nesting that means nesting.
func (s *site) stepList(self string, flow *catalog.Flow, nodes catalog.FlowNodes, counter *int) string {
	var b strings.Builder

	for _, node := range nodes {
		switch n := node.(type) {
		case *catalog.Step:
			*counter++

			arrow := " → "
			if n.From == n.To {
				arrow = " ↺ "
			}
			b.WriteString(strconv.Itoa(*counter) + ". **" + n.From + "**" + arrow + "**" + n.To + "** — " + stepLabel(n) + "\n")

			var notes []string
			if n.Ref != "" {
				notes = append(notes, s.stepRef(self, n))
			}
			if n.Status != catalog.StatusVerified {
				notes = append(notes, "status: "+string(n.Status))
			}
			if n.Line != "" {
				notes = append(notes, code(n.Line))
			}
			if n.Note != "" {
				notes = append(notes, n.Note)
			}
			if len(notes) > 0 {
				// Three spaces line the continuation up under the "1. " marker.
				b.WriteString("   " + strings.Join(notes, " · ") + "\n")
			}

			if n.Status == catalog.StatusUnresolved {
				s.b.warn(flow.ID, "%s step %q is unresolved: %s", flow.ID, n.ID, stepLabel(n))
			}

		case *catalog.Parallel:
			var inner strings.Builder
			inner.WriteString("**In parallel** — " + orDefault(n.Title, "branches that do not wait for each other") + "\n")
			for i, branch := range n.Branches {
				inner.WriteString("\n*Branch " + strconv.Itoa(i+1) + "*\n\n")
				inner.WriteString(s.stepList(self, flow, branch, counter))
			}
			b.WriteString("\n" + quote(inner.String()) + "\n")

		case *catalog.Alt:
			var inner strings.Builder
			// "One of" rather than "if": exactly one branch runs, and a reader
			// who takes the branches for a sequence reads the flow backwards.
			inner.WriteString("**One of**\n")
			for _, branch := range n.Branches {
				title := branch.Title
				if branch.Terminal {
					title += " — *ends the flow*"
				}
				inner.WriteString("\n*" + title + "*\n\n")
				inner.WriteString(s.stepList(self, flow, branch.Steps, counter))
			}
			b.WriteString("\n" + quote(inner.String()) + "\n")

		case *catalog.Loop:
			var inner strings.Builder
			inner.WriteString("**Repeats** — " + n.Title + "\n\n")
			inner.WriteString(s.stepList(self, flow, n.Steps, counter))
			b.WriteString("\n" + quote(inner.String()) + "\n")
		}
	}

	return b.String()
}

// quote wraps a block so it nests visibly, at any depth, without markdown
// mistaking the indentation for something else.
func quote(block string) string {
	lines := strings.Split(strings.TrimRight(block, "\n"), "\n")
	for i, line := range lines {
		if line == "" {
			lines[i] = ">"

			continue
		}
		lines[i] = "> " + line
	}

	return strings.Join(lines, "\n") + "\n"
}

// stepRef links a step to what it refers to. An event id resolves to the
// aggregate page that publishes it; anything else is shown as written.
func (s *site) stepRef(self string, step *catalog.Step) string {
	if step.Kind == catalog.StepEvent {
		if page, ok := s.eventPage[step.Ref]; ok {
			return s.ref(self, page, step.Ref)
		}
		if step.Status != catalog.StatusUnresolved {
			s.b.warn(step.Ref, "step %q refers to event %q, which no service in this catalog publishes", step.ID, step.Ref)
		}
	}

	return code(step.Ref)
}

func stepLabel(step *catalog.Step) string {
	switch {
	case step.Label != "":
		return step.Label
	case step.Ref != "":
		return step.Ref
	default:
		return string(step.Kind)
	}
}

func lastParticipant(nodes catalog.FlowNodes) string {
	for i := len(nodes) - 1; i >= 0; i-- {
		switch n := nodes[i].(type) {
		case *catalog.Step:
			return n.To
		case *catalog.Parallel:
			for j := len(n.Branches) - 1; j >= 0; j-- {
				if p := lastParticipant(n.Branches[j]); p != "" {
					return p
				}
			}
		case *catalog.Alt:
			for j := len(n.Branches) - 1; j >= 0; j-- {
				if p := lastParticipant(n.Branches[j].Steps); p != "" {
					return p
				}
			}
		case *catalog.Loop:
			if p := lastParticipant(n.Steps); p != "" {
				return p
			}
		}
	}

	return ""
}

// mermaidText makes a label safe on a mermaid line. A newline ends the
// statement, a semicolon ends it too, and a bare # opens an entity code.
func mermaidText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\n", " ")
	// Order matters: the escape for # ends in a semicolon, so semicolons go
	// first or the escape is mangled into text.
	s = strings.ReplaceAll(s, ";", ",")
	s = strings.ReplaceAll(s, "#", "#35;")

	return strings.TrimSpace(s)
}

func orDefault(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}

	return s
}
