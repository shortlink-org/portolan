package genmarkdown

import (
	"path"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	flowmermaid "github.com/shortlink-org/portolan/render/mermaid"
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
			owner,
			firstLine(flow.Summary),
		})
	}
	b.WriteString(table([]string{"Flow", "Owner", "Summary"}, rows))

	s.b.file(self, b.String())

	for i := range s.cat.Flows {
		s.renderFlow(&s.cat.Flows[i])
	}
}

func (s *site) renderFlow(flow *catalog.Flow) {
	self := s.pathOf[flow.ID]

	var b strings.Builder
	b.WriteString("# " + flow.Name + "\n\n")
	b.WriteString(s.stamp() + "\n")

	meta := [][]string{
		{"Id", code(flow.ID)},
	}
	if flow.Owner != "" {
		meta = append(meta, []string{"Owner", s.ref(self, flow.Owner, flow.Owner)})
	}
	if flow.Trigger != nil {
		trigger := code(flow.Trigger.Kind)
		if flow.Trigger.Label != "" {
			trigger += " · " + flow.Trigger.Label
		}
		meta = append(meta,
			[]string{"Trigger", trigger},
			[]string{"Root confidence", flow.Trigger.Confidence},
		)
	}
	// Source is the file the flow was read out of, which is the only thing a
	// reader can go and check for themselves.
	if flow.Source != "" {
		meta = append(meta, []string{"Source", s.source(self, flow.Source, s.serviceForSource(flow.Source))})
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

	section(&b, "Sequence", fence("mermaid", flowmermaid.Sequence(flow, func(step *catalog.Step) string {
		return s.flowStepLabel(flow, step)
	})))

	counter := 0
	section(&b, "Steps", s.stepList(self, flow, flow.Steps, &counter))

	s.b.file(self, b.String())
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
			b.WriteString("<a id=\"step-" + anchorID(n.ID) + "\"></a>\n")

			arrow := " → "
			if n.From == n.To {
				arrow = " ↺ "
			}
			b.WriteString(strconv.Itoa(*counter) + ". **" + n.From + "**" + arrow + "**" + n.To + "** — " + s.flowStepLabel(flow, n) + "\n")

			var notes []string
			if n.Ref != "" {
				notes = append(notes, s.stepRef(self, n))
			}
			if n.Status != catalog.StatusVerified {
				notes = append(notes, "status: "+string(n.Status))
			}
			if n.Line != "" {
				location := n.Line
				if flow.Source != "" && path.Dir(sourceFile(n.Line)) == "." {
					location = path.Join(path.Dir(sourceFile(flow.Source)), n.Line)
				}
				notes = append(notes, s.source(self, location, s.serviceForSource(flow.Source)))
			}
			if n.Note != "" {
				notes = append(notes, n.Note)
			}
			if n.HTTP != nil {
				wire := []string{"HTTP"}
				if n.HTTP.Status != 0 {
					wire = append(wire, strconv.Itoa(n.HTTP.Status))
				}
				if n.HTTP.ContentType != "" {
					wire = append(wire, code(n.HTTP.ContentType))
				}
				if n.HTTP.Encoding != "" {
					wire = append(wire, n.HTTP.Encoding)
				}
				if n.HTTP.Outcome != "" {
					wire = append(wire, n.HTTP.Outcome)
				}
				notes = append(notes, strings.Join(wire, " · "))
				if n.HTTP.BodyRef != "" {
					notes = append(notes, "body derived from "+code(n.HTTP.BodyRef))
				}
				if len(n.HTTP.Fields) > 0 {
					fields := make([]string, 0, len(n.HTTP.Fields))
					for _, field := range n.HTTP.Fields {
						fields = append(fields, field.Name+": "+field.Type)
					}
					notes = append(notes, "fields: "+strings.Join(fields, ", "))
				}
				if n.HTTP.Warning != "" {
					notes = append(notes, "warning: "+n.HTTP.Warning)
				}
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
		if _, ok := s.eventPage[step.Ref]; ok {
			return s.eventRef(self, step.Ref, step.Ref)
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

// mermaidText makes a label safe on a mermaid line. A newline ends the
// statement, a semicolon ends it too, and a bare # opens an entity code.
func mermaidText(s string) string {
	return flowmermaid.Text(s)
}

func orDefault(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}

	return s
}

// labelWithAnswer is the step's label, and what comes back when a contract
// says so.
func (s *site) labelWithAnswer(step *catalog.Step) string {
	if answer := s.answer(step); answer != "" {
		return stepLabel(step) + " → " + answer
	}

	return stepLabel(step)
}

// flowStepLabel keeps the response type on its own dashed return arrow once
// composition has synthesized one. Flows without a proven nested return keep
// the compact request → answer label they had before.
func (s *site) flowStepLabel(flow *catalog.Flow, step *catalog.Step) string {
	if step.Kind == catalog.StepResponse {
		return stepLabel(step)
	}
	for _, candidate := range flowSteps(flow.Steps) {
		if candidate.Kind == catalog.StepResponse && candidate.ReplyTo == step.ID {
			return stepLabel(step)
		}
	}
	return s.labelWithAnswer(step)
}

func flowSteps(nodes catalog.FlowNodes) []*catalog.Step {
	var out []*catalog.Step
	var walk func(catalog.FlowNodes)
	walk = func(list catalog.FlowNodes) {
		for _, node := range list {
			switch n := node.(type) {
			case *catalog.Step:
				out = append(out, n)
			case *catalog.Parallel:
				for _, branch := range n.Branches {
					walk(branch)
				}
			case *catalog.Alt:
				for _, branch := range n.Branches {
					walk(branch.Steps)
				}
			case *catalog.Loop:
				walk(n.Steps)
			}
		}
	}
	walk(nodes)
	return out
}

// answer is what the far end of an rpc hands back, as the contract names it.
// The mirror of src/flow/answers.ts, and the prose is there.
//
// Only an rpc has one: a call lands inside a service, which no interface
// describes, and an event is a publication - a reply drawn to one would be a
// lie about the bus.
func (s *site) answer(step *catalog.Step) string {
	if step.Kind != catalog.StepRPC {
		return ""
	}

	// Outgoing: the step names the call, and a call id is "<interface>/<method>".
	if step.Ref != "" {
		return s.methodOf[step.Ref].Response
	}

	// Incoming: somebody called this service, and the label is the operation.
	service, ok := s.services[step.To]
	if !ok || step.Label == "" {
		return ""
	}
	for i := range service.Provides {
		for j := range service.Provides[i].Methods {
			if service.Provides[i].Methods[j].Name == step.Label {
				return service.Provides[i].Methods[j].Response
			}
		}
	}

	return ""
}
