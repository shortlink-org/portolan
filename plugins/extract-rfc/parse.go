package extractrfc

import (
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/shortlink-org/portolan/catalog"
	"gopkg.in/yaml.v3"
)

var rfcHeading = regexp.MustCompile(`(?i)^#\s+(?:(RFC|RFD|KEP)[-\s#:]*)?([A-Za-z0-9._-]+)?\s*(?:[.:—-]\s*)?(.+?)\s*$`)

var builtinLifecycle = map[string]string{
	"draft": "draft", "prediscussion": "draft", "ideation": "draft",
	"proposed": "discussion", "pending": "discussion", "discussion": "discussion", "in review": "discussion", "needs-discussion": "discussion", "open": "discussion",
	"accepted": "accepted", "approved": "accepted", "active": "accepted", "published": "accepted", "merged": "accepted", "resolution/merge": "accepted",
	"implemented": "implemented", "committed": "implemented", "complete": "implemented",
	"rejected": "rejected", "declined": "rejected", "closed": "rejected", "resolution/close": "rejected",
	"postponed": "postponed", "deferred": "postponed", "resolution/postpone": "postponed",
	"withdrawn": "withdrawn", "abandoned": "abandoned", "superseded": "superseded",
}

type frontMatter struct {
	ID            string                  `yaml:"id"`
	RFC           any                     `yaml:"rfc"`
	Title         string                  `yaml:"title"`
	Status        string                  `yaml:"status"`
	State         string                  `yaml:"state"`
	Scope         string                  `yaml:"scope"`
	Authors       stringList              `yaml:"authors"`
	Author        stringList              `yaml:"author"`
	Shepherds     stringList              `yaml:"shepherds"`
	Created       string                  `yaml:"created"`
	CreatedAt     string                  `yaml:"createdAt"`
	Updated       string                  `yaml:"updated"`
	UpdatedAt     string                  `yaml:"updatedAt"`
	Resolved      string                  `yaml:"resolved"`
	ResolvedAt    string                  `yaml:"resolvedAt"`
	Discussion    string                  `yaml:"discussion"`
	DiscussionURL string                  `yaml:"discussionUrl"`
	Relates       catalog.AdrRelates      `yaml:"relates"`
	Links         []catalog.RfcRecordLink `yaml:"links"`
}

type stringList []string

func (s *stringList) UnmarshalYAML(node *yaml.Node) error {
	switch node.Kind {
	case yaml.ScalarNode:
		for _, item := range strings.Split(node.Value, ",") {
			if value := strings.TrimSpace(item); value != "" {
				*s = append(*s, value)
			}
		}
		return nil
	case yaml.SequenceNode:
		return node.Decode((*[]string)(s))
	default:
		return fmt.Errorf("must be a string or list")
	}
}

func parseRFC(file, source string, opts Options) (catalog.Rfc, []string) {
	source = strings.ReplaceAll(source, "\r\n", "\n")
	meta, body, err := splitFrontMatter(source)
	if err != nil {
		return catalog.Rfc{}, []string{file + ": " + err.Error()}
	}
	lines := strings.Split(body, "\n")
	var heading []string
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		heading = rfcHeading.FindStringSubmatch(line)
		break
	}
	if heading == nil {
		return catalog.Rfc{}, []string{file + `: an RFC opens with a Markdown H1 such as "# RFC 0042 — Title"`}
	}
	prefix := strings.ToUpper(strings.TrimSpace(heading[1]))
	if prefix == "" {
		prefix = strings.ToUpper(strings.TrimSpace(opts.Prefix))
	}
	if prefix == "" {
		prefix = "RFC"
	}
	number := scalar(meta.RFC)
	if number == "" && heading[1] != "" {
		number = strings.TrimSpace(heading[2])
	}
	if number == "" {
		base := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
		if match := regexp.MustCompile(`^([0-9]+)[-_]`).FindStringSubmatch(base); match != nil {
			number = match[1]
		}
	}
	title := strings.TrimSpace(meta.Title)
	if title == "" {
		title = strings.TrimSpace(heading[3])
		if heading[1] == "" && heading[2] != "" {
			title = strings.TrimSpace(strings.Join([]string{heading[2], heading[3]}, " "))
		}
	}
	status := strings.TrimSpace(meta.Status)
	if status == "" {
		status = strings.TrimSpace(meta.State)
	}
	var problems []string
	if title == "" {
		problems = append(problems, file+": title is missing")
	}
	if status == "" {
		problems = append(problems, file+": front matter must declare status or state")
	}
	scope, ok := rfcScope(first(meta.Scope, opts.Scope))
	if !ok {
		problems = append(problems, file+`: scope must be "org", a context, or <context>.<service>`)
	}
	display := prefix
	if number != "" {
		display += "-" + number
	}
	id := strings.TrimSpace(meta.ID)
	if id == "" {
		id = scopePrefix(scope) + "." + strings.ToLower(prefix) + "." + first(number, slugify(title))
	}
	slug := slugify(id + "-" + title)
	lifecycle := lifecycleOf(status, opts.StatusMap)
	for _, date := range []struct{ name, value string }{{"createdAt", first(meta.CreatedAt, meta.Created)}, {"updatedAt", first(meta.UpdatedAt, meta.Updated)}, {"resolvedAt", first(meta.ResolvedAt, meta.Resolved)}} {
		if date.value != "" && !validDate(date.value) {
			problems = append(problems, file+": "+date.name+" is not a date or ISO timestamp")
		}
	}
	if len(problems) > 0 {
		return catalog.Rfc{}, problems
	}
	authors := append([]string{}, meta.Authors...)
	authors = append(authors, meta.Author...)
	authors = unique(authors)
	return catalog.Rfc{
		ID: id, Slug: slug, DisplayID: display, Number: number, Title: title,
		Status: status, Lifecycle: lifecycle, Scope: scope, Body: strings.TrimSpace(body) + "\n",
		Authors: authors, Shepherds: unique(meta.Shepherds), CreatedAt: first(meta.CreatedAt, meta.Created),
		UpdatedAt: first(meta.UpdatedAt, meta.Updated), ResolvedAt: first(meta.ResolvedAt, meta.Resolved),
		DiscussionURL: first(meta.DiscussionURL, meta.Discussion), SourceKind: "file", Repository: strings.TrimSpace(opts.Repo), Source: file,
		Relates: meta.Relates, Links: meta.Links,
	}, nil
}

func splitFrontMatter(source string) (frontMatter, string, error) {
	if !strings.HasPrefix(source, "---\n") {
		return frontMatter{}, source, fmt.Errorf("front matter delimited by --- is required")
	}
	end := strings.Index(source[4:], "\n---\n")
	if end < 0 {
		return frontMatter{}, "", fmt.Errorf("front matter has no closing ---")
	}
	end += 4
	var meta frontMatter
	if err := yaml.Unmarshal([]byte(source[4:end]), &meta); err != nil {
		return frontMatter{}, "", fmt.Errorf("front matter: %w", err)
	}
	return meta, source[end+5:], nil
}

func lifecycleOf(status string, custom map[string]string) string {
	key := strings.ToLower(strings.TrimSpace(status))
	for source, lifecycle := range custom {
		if strings.ToLower(strings.TrimSpace(source)) == key {
			return lifecycle
		}
	}
	if lifecycle := builtinLifecycle[key]; lifecycle != "" {
		return lifecycle
	}
	return "unknown"
}

func rfcScope(value string) (catalog.AdrScope, bool) {
	value = strings.TrimSpace(value)
	if value == "" || value == "org" {
		return catalog.AdrScope{Kind: "org"}, true
	}
	parts := strings.Split(value, ".")
	if len(parts) == 1 && slugify(parts[0]) == parts[0] {
		return catalog.AdrScope{Kind: "context", Context: value}, true
	}
	if len(parts) == 2 && slugify(parts[0]) == parts[0] && slugify(parts[1]) == parts[1] {
		return catalog.AdrScope{Kind: "service", Service: value}, true
	}
	return catalog.AdrScope{}, false
}

func scopePrefix(scope catalog.AdrScope) string {
	switch scope.Kind {
	case "context":
		return scope.Context
	case "service":
		return scope.Service
	default:
		return "org"
	}
}

func scalar(value any) string {
	switch item := value.(type) {
	case string:
		return strings.TrimSpace(item)
	case int:
		return fmt.Sprint(item)
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(item))
	}
}

func first(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func slugify(value string) string {
	value = strings.ToLower(value)
	value = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(value, "-")
	return strings.Trim(value, "-")
}

func validDate(value string) bool {
	for _, layout := range []string{"2006-01-02", time.RFC3339} {
		if _, err := time.Parse(layout, value); err == nil {
			return true
		}
	}
	return false
}

func unique(values []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}
