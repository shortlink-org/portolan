package main

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// The format, in one place.
//
//	# Glossary — auth
//
//	One meaning per word inside this context.
//
//	**Session.** Proof that a user logged in, how long that proof is good for,
//	and whether it has been taken away.
//
// A title, an optional line or two saying what the vocabulary covers, then one
// paragraph per term in alphabetical order. The paragraph opens with the term
// in bold and the full stop inside the bold, so `**Email address.**` names a
// two-word term and nothing has to guess where the name ends. Everything after
// it is the definition, carried through as written.
//
// That is the whole format. Nothing here reads the prose for structure: a
// glossary is a person explaining a word to another person, and a parser that
// went looking for shapes inside the explanation would be a parser telling an
// estate how to phrase itself.
var (
	titleLine = regexp.MustCompile(`^#\s+Glossary\b`)
	entryOpen = regexp.MustCompile(`^\*\*(.+?)\.\*\*\s*(.*)$`)
	listItem  = regexp.MustCompile(`^([-*+]|\d+\.)\s`)
)

// A paragraph of the file, flattened to one line, and where it started.
//
// Flattening is what makes the rest of this file about words rather than about
// line breaks: a glossary is hard-wrapped at whatever width its author likes,
// and a soft break inside a paragraph is a space in every markdown renderer
// there is. The line number survives because it is the only thing an error
// message can point at.
type paragraph struct {
	line int
	text string
}

// blocks splits a file into paragraphs on blank lines.
func blocks(src string) []paragraph {
	var out []paragraph

	lines := strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n")
	start := 0
	var held []string
	flush := func() {
		if len(held) == 0 {
			return
		}
		out = append(out, paragraph{line: start, text: strings.Join(held, " ")})
		held = nil
	}
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			flush()

			continue
		}
		if len(held) == 0 {
			start = i + 1
		}
		held = append(held, trimmed)
	}
	flush()

	return out
}

// slug turns a term into the kebab-case form ids and urls use: "Email address"
// becomes email-address, "Password policy" becomes password-policy.
func slug(name string) string {
	var b strings.Builder

	dash := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		default:
			if !dash && b.Len() > 0 {
				b.WriteRune('-')
				dash = true
			}
		}
	}

	return strings.Trim(b.String(), "-")
}

func where(file string, line int) string {
	return fmt.Sprintf("%s:%d: ", file, line)
}

// short quotes the head of a paragraph, for an error that has to say what it
// found instead of what it wanted.
func short(text string) string {
	runes := []rune(text)
	if len(runes) > 40 {
		return `"` + string(runes[:40]) + `…"`
	}

	return `"` + text + `"`
}

// refuse names what a paragraph is, when it is not an entry. A paragraph
// before the first entry is the preamble and is allowed to be anything; after
// one, everything is an entry, and the shapes worth naming are the shapes a
// glossary is otherwise written in.
func refuse(text string, started bool) string {
	switch {
	case strings.HasPrefix(text, "|"):
		return "a table: a glossary is prose, one paragraph per term, so that an entry has room to say what the term is not"
	case strings.HasPrefix(text, "#"):
		return "a heading under the title: a term is a paragraph, not a section of its own"
	case listItem.MatchString(text):
		return "a list: a term is a paragraph opening with **Term.**"
	case started:
		return "a paragraph naming no term; after the first entry every paragraph is one, and it opens with **Term.**"
	}

	return ""
}

// parseGlossary reads one file into terms, the notes worth making about it,
// and the reasons it cannot be read at all.
//
// Errors and warnings are kept apart all the way up: an error is something the
// catalog cannot hold, a warning is something a person should go and write.
func parseGlossary(file, context, src string) (terms []catalog.Term, warns, errs []string) {
	paras := blocks(src)
	if len(paras) == 0 {
		return nil, nil, []string{file + ": the file is empty"}
	}
	if !titleLine.MatchString(paras[0].text) {
		return nil, nil, []string{where(file, paras[0].line) +
			"a glossary opens with `# Glossary — <context>`, and this file opens with " + short(paras[0].text)}
	}

	seen := map[string]int{}
	previous := ""
	started := false
	for _, p := range paras[1:] {
		if !strings.HasPrefix(p.text, "**") {
			if msg := refuse(p.text, started); msg != "" {
				errs = append(errs, where(file, p.line)+msg)
			}

			continue
		}
		started = true

		m := entryOpen.FindStringSubmatch(p.text)
		if m == nil {
			errs = append(errs, where(file, p.line)+
				"an entry opens with the term in bold and the full stop inside it, `**Session.**`")

			continue
		}
		name := strings.TrimSpace(m[1])
		body := strings.TrimSpace(m[2])
		id := slug(name)
		if id == "" {
			errs = append(errs, where(file, p.line)+"a term with no name")

			continue
		}
		if body == "" {
			errs = append(errs, where(file, p.line)+name+" says nothing")

			continue
		}

		if at, taken := seen[id]; taken {
			errs = append(errs, where(file, p.line)+name+fmt.Sprintf(" is already defined on line %d", at))

			continue
		}
		seen[id] = p.line

		// Order is a warning because it costs a reader a moment and costs the
		// catalog nothing: every page sorts what it draws anyway.
		lower := strings.ToLower(name)
		if previous != "" && lower < previous {
			warns = append(warns, where(file, p.line)+name+" sits after "+previous+"; the glossary is alphabetical")
		}
		previous = lower

		terms = append(terms, catalog.Term{
			ID:         context + "." + id,
			Slug:       id,
			Context:    context,
			Name:       name,
			Definition: body,
			Source:     fmt.Sprintf("%s:%d", file, p.line),
		})
	}

	if !started && len(errs) == 0 {
		warns = append(warns, file+": a glossary with no terms in it")
	}

	return terms, warns, errs
}
