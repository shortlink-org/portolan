package verifycodeowners

import "strings"

type dialect uint8

const (
	gitHub dialect = iota
	gitLab
)

type Rule struct {
	Pattern string
	Owners  []string
	Line    int
	Section string
	Exclude bool
}

type Parsed struct {
	Rules    []Rule
	Sections bool
	Defaults map[string][]string
	Order    []string
}

func parseCodeowners(src string) Parsed {
	return parseCodeownersFor(src, gitHub)
}

func parseCodeownersFor(src string, kind dialect) Parsed {
	out := Parsed{Rules: []Rule{}, Defaults: map[string][]string{}, Order: []string{}}
	section := ""
	seenSections := map[string]bool{}

	for i, raw := range strings.Split(src, "\n") {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		if kind == gitLab {
			if name, defaults, ok := parseSection(trimmed); ok {
				out.Sections = true
				section = name
				if !seenSections[name] {
					seenSections[name] = true
					out.Order = append(out.Order, name)
					out.Defaults[name] = defaults
				}
				continue
			}
		} else {
			// GitHub does not support escaping a hash, negation, or ranges.
			if strings.Contains(raw, `\#`) {
				continue
			}
			trimmed = strings.TrimSpace(stripGitHubComment(raw))
			if trimmed == "" || isSection(trimmed) {
				continue
			}
		}

		fields := splitFields(trimmed)
		if len(fields) == 0 {
			continue
		}
		pattern := fields[0]
		exclude := false
		if kind == gitLab && strings.HasPrefix(pattern, "!") {
			exclude = true
			pattern = strings.TrimPrefix(pattern, "!")
		}
		if pattern == "" {
			continue
		}
		if kind == gitHub && (strings.HasPrefix(pattern, "!") || strings.ContainsAny(pattern, "[]")) {
			continue
		}

		owners := validOwners(fields[1:], kind)
		if kind == gitLab && !exclude && len(owners) == 0 && len(out.Defaults[section]) == 0 {
			continue
		}
		if section == "" && kind == gitLab && !seenSections[section] {
			seenSections[section] = true
			out.Order = append(out.Order, section)
		}
		out.Rules = append(out.Rules, Rule{
			Pattern: pattern,
			Owners:  owners,
			Line:    i + 1,
			Section: section,
			Exclude: exclude,
		})
	}

	return out
}

func stripGitHubComment(line string) string {
	if at := strings.IndexByte(line, '#'); at >= 0 {
		return line[:at]
	}
	return line
}

// splitFields is strings.Fields plus the escaped spaces supported by GitLab.
func splitFields(line string) []string {
	fields := []string{}
	var field strings.Builder
	escaped := false
	flush := func() {
		if field.Len() != 0 {
			fields = append(fields, field.String())
			field.Reset()
		}
	}
	for _, r := range line {
		switch {
		case escaped:
			field.WriteRune(r)
			escaped = false
		case r == '\\':
			escaped = true
		case r == ' ' || r == '\t':
			flush()
		default:
			field.WriteRune(r)
		}
	}
	if escaped {
		field.WriteByte('\\')
	}
	flush()
	return fields
}

func validOwners(fields []string, kind dialect) []string {
	owners := []string{}
	for _, owner := range fields {
		valid := strings.HasPrefix(owner, "@") && len(owner) > 1
		if strings.HasPrefix(owner, "@@") && kind != gitLab {
			valid = false
		}
		if at := strings.IndexByte(owner, '@'); at > 0 && at < len(owner)-1 {
			valid = true
		}
		if !valid {
			continue
		}
		owners = append(owners, owner)
	}
	return owners
}

func parseSection(line string) (string, []string, bool) {
	line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "^"))
	if !strings.HasPrefix(line, "[") {
		return "", nil, false
	}
	end := strings.IndexByte(line, ']')
	if end <= 1 {
		return "", nil, false
	}
	name := strings.ToLower(strings.TrimSpace(line[1:end]))
	rest := strings.TrimSpace(line[end+1:])
	if strings.HasPrefix(rest, "[") {
		if countEnd := strings.IndexByte(rest, ']'); countEnd >= 1 {
			rest = strings.TrimSpace(rest[countEnd+1:])
		}
	}
	return name, validOwners(splitFields(rest), gitLab), true
}

func isSection(line string) bool {
	_, _, ok := parseSection(line)
	return ok
}

func hasGitLabSyntax(src string) bool {
	for _, raw := range strings.Split(src, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if isSection(line) {
			return true
		}
		fields := splitFields(line)
		if len(fields) > 0 && strings.HasPrefix(fields[0], "!") {
			return true
		}
		for _, field := range fields[1:] {
			if strings.HasPrefix(field, "@@") {
				return true
			}
		}
	}
	return false
}
