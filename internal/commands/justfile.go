package commands

import (
	"regexp"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

var justRecipe = regexp.MustCompile(`^(@?)([A-Za-z_][A-Za-z0-9_-]*)((?:\s+[+*$]?[A-Za-z_][A-Za-z0-9_-]*(?:=[^\s]+)?)*)\s*:(?:\s|$)`)
var justDocAttribute = regexp.MustCompile(`\[doc\((['"])(.*?)['"]\)\]`)

// readJustfile lists the recipes of a justfile.
//
// A recipe is a name at column 0 followed by its parameters and a colon; the
// lines indented under it are the body. `#` lines directly over the recipe
// are its doc, which is what `just --list` shows too, and a `[doc("...")]`
// attribute beats them. `[private]`, `_`-prefixed and aliased names are left
// out, as `--list` leaves them out.
func readJustfile(file, src string) []catalog.Command {
	lines := strings.Split(src, "\n")
	var out []catalog.Command
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		match := justRecipe.FindStringSubmatch(line)
		if match == nil || strings.HasPrefix(line, "alias ") || strings.HasPrefix(line, "set ") || strings.HasPrefix(line, "mod ") || strings.HasPrefix(line, "import ") {
			continue
		}
		name := match[2]

		// Attributes sit on their own lines above the recipe, above the
		// comment or between it and the recipe; read up through both.
		private := !typeable(name)
		doc := ""
		top := i
		for j := i - 1; j >= 0; j-- {
			text := strings.TrimSpace(lines[j])
			if !strings.HasPrefix(text, "[") {
				break
			}
			if strings.Contains(text, "[private]") {
				private = true
			}
			if m := justDocAttribute.FindStringSubmatch(text); m != nil {
				doc = m[2]
			}
			top = j
		}
		if doc == "" {
			doc = commentAbove(lines, top, "#")
		}
		if private {
			continue
		}

		var body []string
		for j := i + 1; j < len(lines); j++ {
			next := lines[j]
			if strings.HasPrefix(next, " ") || strings.HasPrefix(next, "\t") {
				body = append(body, strings.TrimSpace(next))

				continue
			}
			if strings.TrimSpace(next) == "" {
				continue
			}

			break
		}

		out = append(out, catalog.Command{
			Runner: "just",
			Name:   name,
			Run:    "just " + name,
			Doc:    doc,
			Body:   strings.Join(body, "\n"),
			Source: at(file, i+1),
		})
	}

	return out
}
