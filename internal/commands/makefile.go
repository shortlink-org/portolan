package commands

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// readMakefile lists the targets of a Makefile a person would type.
//
// A target is a line at column 0 with a colon that is not an assignment. Left
// out: special targets (`.PHONY`), pattern and variable-spelled ones (`%.o`,
// `$(BIN)`), and the `_`-prefixed ones a Makefile keeps for itself. The
// description is the `## comment` on the target's own line - the convention
// every `make help` recipe on the internet greps for - or, failing that, the
// comment block sat directly over it. The recipe is the body.
func readMakefile(file, src string) []catalog.Command {
	lines := strings.Split(src, "\n")
	var out []catalog.Command
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		names, rest, ok := makeTargets(line)
		if !ok {
			continue
		}

		doc := ""
		if _, help, found := strings.Cut(rest, "##"); found {
			doc = strings.TrimSpace(help)
		} else {
			doc = commentAbove(lines, i, "#")
		}

		var recipe []string
		for j := i + 1; j < len(lines); j++ {
			next := lines[j]
			if strings.HasPrefix(next, "\t") {
				recipe = append(recipe, strings.TrimSpace(strings.TrimPrefix(next, "\t")))

				continue
			}
			if strings.TrimSpace(next) == "" || strings.HasPrefix(strings.TrimSpace(next), "#") {
				continue
			}

			break
		}
		body := strings.Join(recipe, "\n")

		for _, name := range names {
			if !typeable(name) {
				continue
			}
			out = append(out, catalog.Command{
				Runner: "make",
				Name:   name,
				Run:    "make " + name,
				Doc:    doc,
				Body:   body,
				Source: at(file, i+1),
			})
		}
	}

	return out
}

// makeTargets reads `a b: deps ## help` into its names and the rest of the
// line, and refuses anything that is not a rule: assignments, directives,
// recipes, comments.
func makeTargets(line string) ([]string, string, bool) {
	if line == "" || line[0] == '\t' || line[0] == '#' || line[0] == ' ' {
		return nil, "", false
	}
	colon := strings.IndexByte(line, ':')
	if colon <= 0 {
		return nil, "", false
	}
	head := line[:colon]
	tail := line[colon+1:]
	// `X := 1`, `X ::= 1`, and `X = 1` (no colon at all) are assignments.
	if strings.HasPrefix(tail, "=") || strings.HasPrefix(tail, ":=") || strings.ContainsAny(head, "=#") {
		return nil, "", false
	}
	tail = strings.TrimPrefix(tail, ":")
	names := strings.Fields(head)
	if len(names) == 0 {
		return nil, "", false
	}
	for _, name := range names {
		switch {
		case strings.HasPrefix(name, "."), strings.ContainsAny(name, "%$()"):
			return nil, "", false
		}
	}
	switch names[0] {
	case "ifeq", "ifneq", "ifdef", "ifndef", "else", "endif", "include", "-include", "define", "endef", "export", "unexport", "override", "vpath":
		return nil, "", false
	}

	return names, tail, true
}

func typeable(name string) bool {
	return name != "" && !strings.HasPrefix(name, "_")
}
