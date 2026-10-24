package extractsdd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

var (
	requirementHeading = regexp.MustCompile(`^### Requirement:\s*(.+?)\s*$`)
	scenarioHeading    = regexp.MustCompile(`^#### Scenario:\s*(.+?)\s*$`)
	taskLine           = regexp.MustCompile(`^- \[([ xX])\]\s+([^\s]+)\s+(.+?)\s*$`)
	whenLine           = regexp.MustCompile(`^- \*\*WHEN\*\*\s+(.+?)\s*$`)
	thenLine           = regexp.MustCompile(`^- \*\*THEN\*\*\s+(.+?)\s*$`)
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	base := opts.Root
	if base == "" {
		base = "openspec"
	}
	changesRoot := filepath.Join(in.Root, base, "changes")
	specs, err := readChanges(in, changesRoot, false)
	if err != nil {
		return plugin.Response{}, err
	}
	archived, err := readChanges(in, filepath.Join(changesRoot, "archive"), true)
	if err != nil {
		return plugin.Response{}, err
	}
	specs = append(specs, archived...)
	sort.Slice(specs, func(i, j int) bool { return specs[i].ID < specs[j].ID })

	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{}, Defs: map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{}, Adrs: []catalog.Adr{}, Specs: specs,
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	out := opts.Out
	if out == "" {
		out = "sdd.json"
	}
	return plugin.Response{Files: []plugin.File{{Name: out, Contents: string(encoded) + "\n"}}}, nil
}

func readChanges(in plugin.Input, root string, archived bool) ([]catalog.ChangeSpec, error) {
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return []catalog.ChangeSpec{}, nil
	}
	if err != nil {
		return nil, err
	}
	result := []catalog.ChangeSpec{}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == "archive" {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		if _, err := os.Stat(filepath.Join(dir, ".openspec.yaml")); err != nil {
			continue
		}
		spec, err := readOpenSpecChange(in, dir, entry.Name(), archived)
		if err != nil {
			return nil, err
		}
		result = append(result, spec)
	}
	return result, nil
}

func readOpenSpecChange(in plugin.Input, dir, id string, archived bool) (catalog.ChangeSpec, error) {
	artifacts := []catalog.SpecArtifact{}
	requirements := []catalog.SpecRequirement{}
	tasks := []catalog.SpecTask{}
	for _, named := range []struct{ name, kind string }{{"proposal.md", "proposal"}, {"design.md", "design"}, {"tasks.md", "tasks"}} {
		path := filepath.Join(dir, named.name)
		body, ok, err := readOptional(path)
		if err != nil {
			return catalog.ChangeSpec{}, err
		}
		if !ok {
			continue
		}
		source, err := sourcePath(in, path)
		if err != nil {
			return catalog.ChangeSpec{}, err
		}
		artifacts = append(artifacts, catalog.SpecArtifact{Kind: named.kind, Path: source, Body: body})
		if named.kind == "tasks" {
			tasks = parseTasks(body, source)
		}
	}

	specFiles, err := filepath.Glob(filepath.Join(dir, "specs", "*", "spec.md"))
	if err != nil {
		return catalog.ChangeSpec{}, err
	}
	sort.Strings(specFiles)
	for _, path := range specFiles {
		body, err := os.ReadFile(path)
		if err != nil {
			return catalog.ChangeSpec{}, err
		}
		source, err := sourcePath(in, path)
		if err != nil {
			return catalog.ChangeSpec{}, err
		}
		artifacts = append(artifacts, catalog.SpecArtifact{Kind: "requirements", Path: source, Body: string(body)})
		capability := filepath.Base(filepath.Dir(path))
		requirements = append(requirements, parseRequirements(id, capability, string(body), source)...)
	}

	source := in.RootPath(filepath.ToSlash(filepath.Join(strings.TrimPrefix(dir, in.Root+string(filepath.Separator)), "proposal.md")))
	if len(artifacts) > 0 {
		source = artifacts[0].Path
	}
	lifecycle := taskLifecycle(tasks)
	if archived {
		lifecycle = "archived"
	}
	return catalog.ChangeSpec{
		ID: id, Slug: id, Title: titleOf(id), Format: "openspec", Lifecycle: lifecycle,
		Source: source, Artifacts: artifacts, Requirements: requirements, Tasks: tasks,
	}, nil
}

func readOptional(path string) (string, bool, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return string(raw), true, nil
}

func sourcePath(in plugin.Input, file string) (string, error) {
	rel, err := filepath.Rel(in.Root, file)
	if err != nil {
		return "", err
	}
	return in.RootPath(filepath.ToSlash(rel)), nil
}

func parseTasks(body, source string) []catalog.SpecTask {
	result := []catalog.SpecTask{}
	for lineNo, line := range strings.Split(body, "\n") {
		match := taskLine.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		result = append(result, catalog.SpecTask{
			ID: match[2], Title: strings.TrimSpace(match[3]), Done: strings.TrimSpace(match[1]) != "",
			Source: fmt.Sprintf("%s:%d", source, lineNo+1),
		})
	}
	return result
}

func parseRequirements(change, capability, body, source string) []catalog.SpecRequirement {
	lines := strings.Split(body, "\n")
	result := []catalog.SpecRequirement{}
	for i := 0; i < len(lines); {
		match := requirementHeading.FindStringSubmatch(lines[i])
		if match == nil {
			i++
			continue
		}
		title := strings.TrimSpace(match[1])
		requirement := catalog.SpecRequirement{
			ID: change + "/" + capability + "/" + slugify(title), Title: title,
			Source: fmt.Sprintf("%s:%d", source, i+1), Scenarios: []catalog.SpecScenario{},
		}
		i++
		text := []string{}
		for i < len(lines) && requirementHeading.FindStringSubmatch(lines[i]) == nil {
			if scenario := scenarioHeading.FindStringSubmatch(lines[i]); scenario != nil {
				item := catalog.SpecScenario{Name: strings.TrimSpace(scenario[1]), When: []string{}, Then: []string{}}
				i++
				for i < len(lines) && scenarioHeading.FindStringSubmatch(lines[i]) == nil && requirementHeading.FindStringSubmatch(lines[i]) == nil {
					if when := whenLine.FindStringSubmatch(lines[i]); when != nil {
						item.When = append(item.When, strings.TrimSpace(when[1]))
					}
					if then := thenLine.FindStringSubmatch(lines[i]); then != nil {
						item.Then = append(item.Then, strings.TrimSpace(then[1]))
					}
					i++
				}
				requirement.Scenarios = append(requirement.Scenarios, item)
				continue
			}
			if strings.TrimSpace(lines[i]) != "" && !strings.HasPrefix(lines[i], "## ") {
				text = append(text, strings.TrimSpace(lines[i]))
			}
			i++
		}
		requirement.Text = strings.Join(text, "\n")
		result = append(result, requirement)
	}
	return result
}

func taskLifecycle(tasks []catalog.SpecTask) string {
	if len(tasks) == 0 {
		return "draft"
	}
	done := 0
	for _, task := range tasks {
		if task.Done {
			done++
		}
	}
	if done == 0 {
		return "planned"
	}
	if done == len(tasks) {
		return "complete"
	}
	return "implementing"
}

func titleOf(id string) string {
	words := strings.ReplaceAll(id, "-", " ")
	if words == "" {
		return ""
	}
	return strings.ToUpper(words[:1]) + words[1:]
}

func slugify(value string) string {
	value = strings.ToLower(value)
	var b strings.Builder
	dash := false
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
			dash = false
		} else if b.Len() > 0 && !dash {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(b.String(), "-")
}
