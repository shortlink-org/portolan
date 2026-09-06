package commands

import (
	"regexp"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

var tomlHeader = regexp.MustCompile(`^\[([^\]]+)\]\s*$`)
var tomlKey = regexp.MustCompile(`^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$`)
var tomlString = regexp.MustCompile(`^(?:"((?:[^"\\]|\\.)*)"|'([^']*)')`)
var tomlInlineField = regexp.MustCompile(`(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|\[([^\]]*)\])`)

// readPyproject lists the tasks of the two task runners that live in
// pyproject.toml: poe (`[tool.poe.tasks]`) and pdm (`[tool.pdm.scripts]`).
// Python has no runner of its own, and uv has no task section, so a
// pyproject without one of these tables declares no commands.
//
// The reader is a line scanner, not a TOML parser: it follows table headers
// and reads `name = "cmd"`, `name = ["cmd", "arg"]`, `name = { cmd = "...",
// help = "..." }` and `[tool.poe.tasks.name]` subtables. That is the whole of
// what either runner's documentation shows, and a full parser would be a
// dependency for the sake of shapes nobody writes.
func readPyproject(file, src string) []catalog.Command {
	runners := []struct {
		table  string
		runner string
		run    string
	}{
		{"tool.poe.tasks", "poe", "poe "},
		{"tool.pdm.scripts", "pdm", "pdm run "},
	}

	lines := strings.Split(src, "\n")
	var out []catalog.Command
	for _, r := range runners {
		var cmds []catalog.Command
		byName := map[string]int{}
		upsert := func(cmd catalog.Command) {
			if i, ok := byName[cmd.Name]; ok {
				if cmd.Doc != "" {
					cmds[i].Doc = cmd.Doc
				}
				if cmd.Body != "" {
					cmds[i].Body = cmd.Body
				}

				return
			}
			byName[cmd.Name] = len(cmds)
			cmds = append(cmds, cmd)
		}

		table := ""
		for i, line := range lines {
			text := strings.TrimSpace(line)
			if m := tomlHeader.FindStringSubmatch(text); m != nil {
				table = strings.TrimSpace(m[1])

				continue
			}
			if text == "" || strings.HasPrefix(text, "#") {
				continue
			}
			m := tomlKey.FindStringSubmatch(text)
			if m == nil {
				continue
			}
			key, value := strings.Trim(m[1], `"`), strings.TrimSpace(m[2])

			switch {
			case table == r.table:
				// `name = ...` in the tasks table itself.
				cmd := catalog.Command{Runner: r.runner, Name: key, Run: r.run + key, Source: at(file, i+1)}
				cmd.Body, cmd.Doc = tomlTask(value)
				upsert(cmd)
			case strings.HasPrefix(table, r.table+"."):
				// `[tool.poe.tasks.name]` and its fields.
				name := strings.Trim(strings.TrimPrefix(table, r.table+"."), `"`)
				cmd := catalog.Command{Runner: r.runner, Name: name, Run: r.run + name}
				if _, known := byName[name]; !known {
					cmd.Source = at(file, i+1)
					for j := i - 1; j >= 0; j-- {
						if tomlHeader.MatchString(strings.TrimSpace(lines[j])) {
							cmd.Source = at(file, j+1)

							break
						}
					}
				}
				switch key {
				case "cmd", "script", "shell", "call", "expr", "ref":
					cmd.Body = tomlScalar(value)
				case "sequence", "composite":
					cmd.Body = strings.Join(tomlList(value), "\n")
				case "help":
					cmd.Doc = tomlScalar(value)
				}
				upsert(cmd)
			}
		}
		out = append(out, cmds...)
	}

	return hooks(filterTypeable(out), "pre_", "post_")
}

func filterTypeable(cmds []catalog.Command) []catalog.Command {
	kept := cmds[:0]
	for _, cmd := range cmds {
		if typeable(cmd.Name) {
			kept = append(kept, cmd)
		}
	}

	return kept
}

// tomlTask reads the value of a task entry: a string, a list, or an inline
// table with a cmd and a help.
func tomlTask(value string) (body, doc string) {
	switch {
	case strings.HasPrefix(value, "{"):
		for _, m := range tomlInlineField.FindAllStringSubmatch(value, -1) {
			field := m[1]
			text := unescape(m[2] + m[3])
			switch field {
			case "cmd", "script", "shell", "call", "expr", "ref":
				body = text
			case "sequence", "composite":
				body = strings.Join(tomlList("["+m[4]+"]"), "\n")
			case "help":
				doc = text
			}
		}

		return body, doc
	case strings.HasPrefix(value, "["):
		return strings.Join(tomlList(value), " "), ""
	}

	return tomlScalar(value), ""
}

func tomlScalar(value string) string {
	if m := tomlString.FindStringSubmatch(value); m != nil {
		return unescape(m[1] + m[2])
	}
	if strings.HasPrefix(value, `"""`) {
		return strings.TrimSpace(strings.Trim(value, `"`))
	}

	return strings.TrimSpace(value)
}

func tomlList(value string) []string {
	inner := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(value), "["), "]")
	var items []string
	for _, m := range regexp.MustCompile(`"((?:[^"\\]|\\.)*)"|'([^']*)'`).FindAllStringSubmatch(inner, -1) {
		items = append(items, unescape(m[1]+m[2]))
	}

	return items
}

func unescape(s string) string {
	return strings.NewReplacer(`\"`, `"`, `\\`, `\`, `\n`, "\n", `\t`, "\t").Replace(s)
}
