// Package mermaid renders catalog flows as Mermaid sequence diagrams.
package mermaid

import (
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// Sequence renders one flow. label supplies the text for each arrow, allowing
// exporters to enrich an RPC without duplicating the structural walk.
func Sequence(flow *catalog.Flow, label func(*catalog.Step) string) string {
	aliases := make(map[string]string, len(flow.Participants))
	for i := range flow.Participants {
		aliases[flow.Participants[i].ID] = "p" + strconv.Itoa(i)
	}

	var b strings.Builder
	b.WriteString("sequenceDiagram\n    autonumber\n")
	for i := range flow.Participants {
		participant := &flow.Participants[i]
		keyword := "participant"
		if participant.Kind == catalog.ParticipantActor {
			keyword = "actor"
		}
		name := participant.Label
		if name == "" {
			name = participant.ID
		}
		b.WriteString("    " + keyword + " " + aliases[participant.ID] + " as " + Text(name) + "\n")
	}
	renderNodes(&b, flow.Steps, aliases, 1, label)
	return b.String()
}

func renderNodes(b *strings.Builder, nodes catalog.FlowNodes, aliases map[string]string, depth int, label func(*catalog.Step) string) {
	indent := strings.Repeat("    ", depth)
	for _, node := range nodes {
		switch n := node.(type) {
		case *catalog.Step:
			arrow := "->>"
			if n.Kind == catalog.StepResponse {
				arrow = "-->>"
			} else if n.Kind == catalog.StepEvent {
				arrow = "-)"
			}
			message := aliases[n.From] + arrow + aliases[n.To] + ": " + Text(label(n))
			if n.HTTP != nil && n.HTTP.Outcome == "error" {
				b.WriteString(indent + "rect rgba(183, 100, 107, 0.12)\n")
				b.WriteString(indent + "    " + message + "\n")
				b.WriteString(indent + "end\n")
			} else {
				b.WriteString(indent + message + "\n")
			}
		case *catalog.Parallel:
			b.WriteString(indent + "par " + Text(defaulted(n.Title, "in parallel")) + "\n")
			for i, branch := range n.Branches {
				if i > 0 {
					b.WriteString(indent + "and\n")
				}
				renderNodes(b, branch, aliases, depth+1, label)
			}
			b.WriteString(indent + "end\n")
		case *catalog.Alt:
			for i, branch := range n.Branches {
				keyword := "else "
				if i == 0 {
					keyword = "alt "
				}
				b.WriteString(indent + keyword + Text(branch.Title) + "\n")
				renderNodes(b, branch.Steps, aliases, depth+1, label)
				if branch.Terminal {
					if last := lastParticipant(branch.Steps); last != "" {
						b.WriteString(strings.Repeat("    ", depth+1) + "Note over " + aliases[last] + ": flow ends here\n")
					}
				}
			}
			b.WriteString(indent + "end\n")
		case *catalog.Loop:
			b.WriteString(indent + "loop " + Text(n.Title) + "\n")
			renderNodes(b, n.Steps, aliases, depth+1, label)
			b.WriteString(indent + "end\n")
		}
	}
}

func lastParticipant(nodes catalog.FlowNodes) string {
	for i := len(nodes) - 1; i >= 0; i-- {
		switch n := nodes[i].(type) {
		case *catalog.Step:
			return n.To
		case *catalog.Parallel:
			for j := len(n.Branches) - 1; j >= 0; j-- {
				if participant := lastParticipant(n.Branches[j]); participant != "" {
					return participant
				}
			}
		case *catalog.Alt:
			for j := len(n.Branches) - 1; j >= 0; j-- {
				if participant := lastParticipant(n.Branches[j].Steps); participant != "" {
					return participant
				}
			}
		case *catalog.Loop:
			if participant := lastParticipant(n.Steps); participant != "" {
				return participant
			}
		}
	}
	return ""
}

// Text prevents a label from ending a Mermaid statement or opening an entity code.
func Text(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, ";", ",")
	value = strings.ReplaceAll(value, "#", "#35;")
	return strings.TrimSpace(value)
}

func defaulted(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
