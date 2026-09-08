package genmarkdown

import (
	"net/url"
	"path"
	"regexp"
	"strings"
	"unicode"

	"github.com/shortlink-org/portolan/catalog"
)

var sourceLine = regexp.MustCompile(`^(.+):(\d+)$`)

// source renders a catalog location as a forge link when the generator has a
// stable source base, or an immutable pin for an external repository.
func (s *site) source(from, where string, owner *catalog.Service) string {
	if where == "" {
		return ""
	}
	label := code(where)
	file, line := where, ""
	if match := sourceLine.FindStringSubmatch(where); len(match) == 3 {
		file, line = match[1], match[2]
	}
	if strings.ContainsAny(file, " \t\n") || strings.HasPrefix(file, "/") {
		return label
	}
	directory := strings.HasSuffix(file, "/")

	prefix, ok := s.sourcePrefix(owner, directory)
	if !ok {
		return label
	}
	if owner != nil && owner.Path != "" && !strings.HasPrefix(file, owner.Path+"/") && file != owner.Path {
		file = path.Join(owner.Path, file)
	}
	file = remotePath(file, owner)
	if file == "." || file == "" {
		return label
	}

	file = strings.TrimSuffix(file, "/")
	href := strings.TrimSuffix(prefix, "/") + "/" + escapePath(file)
	if line != "" {
		href += "#L" + line
	}
	return "[" + label + "](" + href + ")"
}

func (s *site) serviceForSource(where string) *catalog.Service {
	file := sourceFile(where)
	var best *catalog.Service
	for _, svc := range s.services {
		if svc.Path != "" && (file == svc.Path || strings.HasPrefix(file, svc.Path+"/")) &&
			(best == nil || len(svc.Path) > len(best.Path)) {
			best = svc
		}
	}
	return best
}

func (s *site) sourcePrefix(owner *catalog.Service, directory bool) (string, bool) {
	wanted := ""
	if owner != nil {
		wanted = bareRepo(owner.Repo)
	}
	for i := range s.cat.Repos {
		pin := &s.cat.Repos[i]
		if pin.Commit != "" && bareRepo(pin.Repo) == wanted {
			view := "/blob/"
			if directory {
				view = "/tree/"
			}
			repo := "https://" + bareRepo(pin.Repo)
			if strings.Contains(strings.ToLower(repo), "gitlab") {
				view = "/-/" + strings.Trim(view, "/") + "/"
			}
			return repo + view + url.PathEscape(pin.Commit), true
		}
	}
	base := strings.TrimSuffix(s.opts.SourceBaseURL, "/")
	if base == "" || (wanted != "" && sourceBaseRepo(base) != wanted) {
		return "", false
	}
	if directory {
		base = strings.Replace(base, "/-/blob/", "/-/tree/", 1)
		base = strings.Replace(base, "/blob/", "/tree/", 1)
	}
	return base, true
}

func sourceBaseRepo(base string) string {
	for _, marker := range []string{"/-/blob/", "/-/tree/", "/blob/", "/tree/"} {
		if at := strings.Index(base, marker); at >= 0 {
			return bareRepo(base[:at])
		}
	}
	return bareRepo(base)
}

func bareRepo(value string) string {
	return strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(value, "https://"), "http://"), "/"), ".git"))
}

func repoLink(repo string) string {
	if repo == "" {
		return ""
	}
	href := repo
	if !strings.Contains(repo, "://") {
		href = "https://" + repo
	}
	return "[" + code(repo) + "](" + strings.TrimSuffix(href, ".git") + ")"
}

func remotePath(file string, owner *catalog.Service) string {
	if owner == nil || owner.Repo == "" {
		return file
	}
	parts := strings.Split(bareRepo(owner.Repo), "/")
	if len(parts) < 3 {
		return file
	}
	prefix := "vendor/repos/" + parts[len(parts)-2] + "/" + parts[len(parts)-1] + "/"
	return strings.TrimPrefix(file, prefix)
}

func escapePath(value string) string {
	parts := strings.Split(value, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.Join(parts, "/")
}

// anchorID is independent of a renderer's heading-slug algorithm. Explicit
// anchors keep deep links stable when a title changes punctuation or case.
func anchorID(value string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(value) {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r):
			b.WriteRune(r)
			dash = false
		case b.Len() > 0 && !dash:
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func (s *site) eventRef(from, eventID, text string) string {
	pageID := s.eventPage[eventID]
	page, ok := s.pathOf[pageID]
	if !ok {
		return code(text)
	}
	return "[" + code(text) + "](" + rel(from, page) + "#event-" + anchorID(eventID) + ")"
}

func (s *site) viaRef(from string, via *catalog.EdgeVia) string {
	if via == nil || via.Flow == "" {
		return ""
	}
	page, ok := s.pathOf[via.Flow]
	if !ok {
		return code(via.Flow + "#" + via.Step)
	}
	suffix := ""
	if via.Step != "" {
		suffix = "#step-" + anchorID(via.Step)
	}
	return "[" + code(via.Flow+"#"+via.Step) + "](" + rel(from, page) + suffix + ")"
}
