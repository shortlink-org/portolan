package commands

import (
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/shortlink-org/portolan/catalog"
)

// readTaskfile lists the tasks of a Taskfile, in the order the file lists
// them. A task marked `internal` is not one `task --list` offers and is not
// one here. `desc` is the doc, and `summary` stands in when there is no desc.
// The cmds are the body; a cmd that calls another task is written as the
// runner would show it.
func readTaskfile(file, src string) ([]catalog.Command, []string) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(src), &doc); err != nil {
		return nil, []string{file + ": not YAML, so no tasks were read: " + err.Error()}
	}
	root := doc.Content
	if len(root) == 0 || root[0].Kind != yaml.MappingNode {
		return nil, nil
	}
	tasks := mappingValue(root[0], "tasks")
	if tasks == nil || tasks.Kind != yaml.MappingNode {
		return nil, nil
	}

	var out []catalog.Command
	for i := 0; i+1 < len(tasks.Content); i += 2 {
		key, value := tasks.Content[i], tasks.Content[i+1]
		name := key.Value
		if !typeable(name) {
			continue
		}
		cmd := catalog.Command{
			Runner: "task",
			Name:   name,
			Run:    "task " + name,
			Source: at(file, key.Line),
		}
		switch value.Kind {
		case yaml.ScalarNode:
			cmd.Body = value.Value
		case yaml.SequenceNode:
			cmd.Body = strings.Join(cmdLines(value), "\n")
		case yaml.MappingNode:
			if internal := mappingValue(value, "internal"); internal != nil && internal.Value == "true" {
				continue
			}
			if desc := mappingValue(value, "desc"); desc != nil {
				cmd.Doc = strings.TrimSpace(desc.Value)
			} else if summary := mappingValue(value, "summary"); summary != nil {
				cmd.Doc = strings.TrimSpace(summary.Value)
			}
			if cmds := mappingValue(value, "cmds"); cmds != nil {
				cmd.Body = strings.Join(cmdLines(cmds), "\n")
			} else if single := mappingValue(value, "cmd"); single != nil {
				cmd.Body = single.Value
			}
		}
		out = append(out, cmd)
	}

	return out, nil
}

func mappingValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}

	return nil
}

func cmdLines(node *yaml.Node) []string {
	var lines []string
	if node.Kind == yaml.ScalarNode {
		return []string{strings.TrimSpace(node.Value)}
	}
	for _, item := range node.Content {
		switch item.Kind {
		case yaml.ScalarNode:
			lines = append(lines, strings.TrimSpace(item.Value))
		case yaml.MappingNode:
			if cmd := mappingValue(item, "cmd"); cmd != nil {
				lines = append(lines, strings.TrimSpace(cmd.Value))
			} else if task := mappingValue(item, "task"); task != nil {
				lines = append(lines, "task "+task.Value)
			}
		}
	}

	return lines
}
