package genmarkdown

import (
	"fmt"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

type specActivityEvent struct {
	key      string
	kind     string
	evidence string
	summary  string
	source   string
}

// specActivity is the static-catalog side of the shared activity projection.
// Git, comparison and changed-path events are host enrichments; the generator
// can reproduce only the current author-intent events present in the catalog.
func specActivity(spec *catalog.ChangeSpec) []specActivityEvent {
	events := []specActivityEvent{{
		key: "intent:lifecycle:" + spec.ID + ":" + spec.Lifecycle, kind: "spec.lifecycle",
		evidence: "Author intent", summary: "Lifecycle is " + spec.Lifecycle, source: spec.Source,
	}}
	for _, task := range spec.Tasks {
		if !task.Done {
			continue
		}
		events = append(events, specActivityEvent{
			key: "intent:task:" + spec.ID + ":" + task.ID + ":completed", kind: "task.completed",
			evidence: "Author intent", summary: task.ID + " is marked complete", source: task.Source,
		})
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].kind != events[j].kind {
			return events[i].kind < events[j].kind
		}
		return events[i].key < events[j].key
	})
	return events
}

func (s *site) renderSpecs() {
	if len(s.cat.Specs) == 0 {
		return
	}
	const self = "spec/README.md"
	var b strings.Builder
	b.WriteString("# Specifications\n\n" + s.stamp() + "\n")
	b.WriteString("Lifecycle and checklist progress come from the specification; implementation evidence is tracked separately.\n\n")
	rows := make([][]string, 0, len(s.cat.Specs))
	for i := range s.cat.Specs {
		spec := &s.cat.Specs[i]
		rows = append(rows, []string{
			s.ref(self, spec.ID, spec.Title), spec.Format, spec.Lifecycle,
			fmt.Sprintf("%d / %d", doneTasks(spec), len(spec.Tasks)),
			plural(len(spec.Requirements), "requirement"),
		})
	}
	b.WriteString(table([]string{"Change", "Format", "Lifecycle", "Checklist", "Requirements"}, rows))
	s.b.file(self, b.String())
	for i := range s.cat.Specs {
		s.renderSpec(&s.cat.Specs[i])
	}
}

func doneTasks(spec *catalog.ChangeSpec) int {
	done := 0
	for _, task := range spec.Tasks {
		if task.Done {
			done++
		}
	}
	return done
}

func (s *site) renderSpec(spec *catalog.ChangeSpec) {
	self := s.pathOf[spec.ID]
	var b strings.Builder
	b.WriteString("# " + spec.Title + "\n\n" + s.stamp() + "\n")
	b.WriteString(defList([][]string{
		{"ID", code(spec.ID)}, {"Format", spec.Format}, {"Lifecycle", spec.Lifecycle},
		{"Source", code(spec.Source)}, {"Checklist", fmt.Sprintf("%d / %d", doneTasks(spec), len(spec.Tasks))},
	}))
	b.WriteString("\n> Checklist progress is author intent. It is not proof that code, runtime behavior, or the architecture catalog conforms to this specification.\n")
	activityRows := make([][]string, 0)
	for _, event := range specActivity(spec) {
		activityRows = append(activityRows, []string{code(event.kind), event.evidence, event.summary, code(event.source)})
	}
	section(&b, "Activity", table([]string{"Event", "Evidence", "Summary", "Source"}, activityRows))
	for _, artifact := range spec.Artifacts {
		if artifact.Kind != "proposal" && artifact.Kind != "design" {
			continue
		}
		title := strings.ToUpper(artifact.Kind[:1]) + artifact.Kind[1:]
		section(&b, title, "*Source: "+code(artifact.Path)+"*\n\n"+artifact.Body+"\n")
	}
	var requirements strings.Builder
	for _, requirement := range spec.Requirements {
		requirements.WriteString("### " + requirement.Title + "\n\n")
		requirements.WriteString("*Source: " + code(requirement.Source) + "*\n\n")
		if requirement.Text != "" {
			requirements.WriteString(requirement.Text + "\n\n")
		}
		for _, scenario := range requirement.Scenarios {
			requirements.WriteString("#### " + scenario.Name + "\n\n")
			for _, line := range scenario.When {
				requirements.WriteString("- **WHEN** " + line + "\n")
			}
			for _, line := range scenario.Then {
				requirements.WriteString("- **THEN** " + line + "\n")
			}
			requirements.WriteString("\n")
		}
	}
	section(&b, "Requirements", requirements.String())
	var tasks strings.Builder
	for _, task := range spec.Tasks {
		mark := " "
		if task.Done {
			mark = "x"
		}
		tasks.WriteString(fmt.Sprintf("- [%s] `%s` %s — `%s`\n", mark, task.ID, task.Title, task.Source))
	}
	section(&b, "Tasks", tasks.String())
	s.b.file(self, b.String())
}
