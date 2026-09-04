package main

import (
	"strings"

	"github.com/shortlink-org/portolan/plugin"
)

// The site for a language model, in the shape llmstxt.org asks for.
//
// llms.txt is the index page again as flat lists: one H1, one blockquote that
// says what the estate is, then a link and a line of context per entity. A
// reader that fetches pages on demand starts here.
//
// llms-full.txt is every page of the site in one file, for a reader that has a
// context window and not a filesystem. It is assembled from the pages already
// rendered, not rendered again, so it cannot disagree with them.
//
// Neither takes the estate's public URL: the links are the same relative
// paths every other page uses, correct wherever the docs directory is mounted.
const (
	llmsPage     = "llms.txt"
	llmsFullPage = "llms-full.txt"
)

// renderLlms runs last. Everything the builder holds at that point is the
// site, and llms-full.txt is that, in that order.
func (s *site) renderLlms() {
	pages := append([]plugin.File(nil), s.b.Files...)

	s.b.file(llmsPage, s.llmsIndex())
	s.b.file(llmsFullPage, s.llmsFull(pages))
}

func (s *site) llmsIndex() string {
	const self = llmsPage

	var b strings.Builder
	b.WriteString("# " + s.title() + "\n\n")
	b.WriteString("> " + s.llmsSummary() + "\n\n")
	b.WriteString(s.stamp() + "\n")
	b.WriteString("Every link below is a markdown page beside this file. " +
		"[" + llmsFullPage + "](" + llmsFullPage + ") is all of those pages in one file, " +
		"in the order the site lists them.\n")

	var contexts, services []string
	for i := range s.cat.Contexts {
		ctx := &s.cat.Contexts[i]
		contexts = append(contexts, entry(s.ref(self, ctx.ID, ctx.Name), string(ctx.Classification), firstLine(ctx.Summary)))

		for j := range ctx.Services {
			svc := &ctx.Services[j]
			names := make([]string, 0, len(svc.Aggregates))
			for k := range svc.Aggregates {
				names = append(names, svc.Aggregates[k].Name)
			}
			aggregates := ""
			if len(names) > 0 {
				aggregates = "Aggregates: " + strings.Join(names, ", ")
			}
			services = append(services, entry(s.ref(self, svc.ID, svc.Name), "in "+ctx.Name, aggregates))
		}
	}
	section(&b, "Contexts", list(contexts))
	section(&b, "Services", list(services))

	flows := make([]string, 0, len(s.cat.Flows))
	for i := range s.cat.Flows {
		flow := &s.cat.Flows[i]
		owner := ""
		if flow.Owner != "" {
			owner = "owned by " + s.ref(self, flow.Owner, flow.Owner)
		}
		flows = append(flows, entry(s.ref(self, flow.ID, flow.Name), owner, firstLine(flow.Summary)))
	}
	section(&b, "Flows", list(flows))

	adrs := make([]string, 0, len(s.cat.Adrs))
	for i := range s.cat.Adrs {
		adr := &s.cat.Adrs[i]
		var when []string
		if adr.Status != "" {
			when = append(when, string(adr.Status))
		}
		if adr.Date != "" {
			when = append(when, adr.Date)
		}
		title := adr.Title
		if len(when) > 0 {
			title += " (" + strings.Join(when, ", ") + ")"
		}
		adrs = append(adrs, entry(s.ref(self, adr.ID, adr.ID), title))
	}
	section(&b, "Decisions", list(adrs))

	// What llmstxt.org calls Optional: pages a reader short on context can
	// skip. The shape of a shared type or a table matters once a page above
	// has named it, and not before.
	var optional []string
	if len(s.cat.Defs) > 0 {
		optional = append(optional, entry(link("Shared types", self, typesPage),
			"types named by more than one aggregate, event or message"))
	}
	for i := range s.cat.Stores {
		store := &s.cat.Stores[i]
		note := string(store.Kind) + " store"
		if owner, ok := s.services[store.Owner]; ok {
			note += " of " + s.ref(self, owner.ID, owner.Name)
		}
		optional = append(optional, entry(s.ref(self, store.ID, store.Name), note, plural(len(store.Tables), "table")))
	}
	section(&b, "Optional", list(optional))

	return b.String()
}

// llmsSummary is the blockquote: what kind of thing this is, and how much of
// it there is.
func (s *site) llmsSummary() string {
	services, aggregates := 0, 0
	for i := range s.cat.Contexts {
		services += len(s.cat.Contexts[i].Services)
		for j := range s.cat.Contexts[i].Services {
			aggregates += len(s.cat.Contexts[i].Services[j].Aggregates)
		}
	}

	parts := []string{
		plural(len(s.cat.Contexts), "bounded context"),
		plural(services, "service"),
		plural(aggregates, "aggregate"),
		plural(len(s.cat.Stores), "store"),
		plural(len(s.cat.Flows), "flow"),
		plural(len(s.cat.Adrs), "decision record"),
	}

	return "Architecture catalog of " + s.title() + ": " + strings.Join(parts[:len(parts)-1], ", ") +
		" and " + parts[len(parts)-1] + ", read from the code, the specs and the traces of the estate."
}

func (s *site) llmsFull(pages []plugin.File) string {
	var b strings.Builder
	b.WriteString("*" + llmsFullPage + ": every page of " + s.title() + ", one after another. " +
		"A page begins with a comment naming its file, and the links inside it are " +
		"relative to that file's directory.*\n\n")
	b.WriteString(s.stamp())

	for _, page := range pages {
		b.WriteString("\n<!-- " + page.Name + " -->\n\n")
		b.WriteString(strings.TrimRight(page.Contents, "\n") + "\n")
	}

	return b.String()
}

// entry is one line of an llms.txt list: the link, then whatever notes are
// not empty, sentence by sentence.
func entry(link string, notes ...string) string {
	kept := make([]string, 0, len(notes))
	for _, note := range notes {
		note = strings.TrimSpace(note)
		if note == "" {
			continue
		}
		kept = append(kept, strings.TrimSuffix(note, "."))
	}
	if len(kept) == 0 {
		return "- " + link
	}

	return "- " + link + ": " + strings.Join(kept, ". ")
}

func list(items []string) string {
	if len(items) == 0 {
		return ""
	}

	return strings.Join(items, "\n") + "\n"
}
