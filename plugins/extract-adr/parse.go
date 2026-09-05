package main

import (
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/shortlink-org/portolan/catalog"
)

// The format, in one place.
//
//	# auth.0003 — Session expiry publishes no event
//
//	- **Status:** accepted
//	- **Date:** 2026-08-22
//	- **Scope:** auth.auth
//	- **Superseded by:** auth.0007                      optional
//	- **Supersedes:** auth.0001, auth.0002              optional
//	- **Relates:** auth.auth.session.SessionEnded, shop.cart, checkout
//	- **Note:** prose the catalog has no other field for
//
//	## Context and Problem Statement
//	…
//
// The title carries the id and, after an em dash, the title itself. The id's
// prefix is whatever the record is about - a service (`auth`), a context
// (`payments`) or the organisation (`org`) - and the four digits after it are
// the record's number, which the file's own name repeats.
//
// The bullets are everything the markdown knows that the prose does not say
// in a form anything can read. Status, Date and Scope are required; the rest
// are written when there is something to write. `Relates` names events,
// services and flows in one list and they are told apart by their shape,
// because a record's author should not have to remember which of three lists
// a name belongs in.
//
// Everything from the first `##` onward is the record. It is frozen history:
// it goes into the catalog exactly as written and comes out onto the page the
// same way, and nothing in it is ever regenerated from the model as it stands
// now.

var (
	titleLine  = regexp.MustCompile(`^#\s+(\S+)\s+—\s+(.+?)\s*$`)
	bulletLine = regexp.MustCompile(`^-\s+\*\*([^*:]+):\*\*\s*(.*?)\s*$`)
	bodyStart  = regexp.MustCompile(`^##\s`)
	fileName   = regexp.MustCompile(`^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$`)
	adrID      = regexp.MustCompile(`^([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)\.(\d+)$`)
	scopeValue = regexp.MustCompile(`^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)?$`)
	flowSlug   = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	eventID    = regexp.MustCompile(`^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$`)
	serviceID  = regexp.MustCompile(`^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`)
)

var statuses = map[string]catalog.AdrStatus{
	"proposed":   catalog.AdrProposed,
	"accepted":   catalog.AdrAccepted,
	"superseded": catalog.AdrSuperseded,
	"deprecated": catalog.AdrDeprecated,
	"rejected":   catalog.AdrRejected,
}

type parser struct {
	file  string
	lines []string
	errs  []string

	adr catalog.Adr
}

// parseAdr reads one record. Every mistake it can find is collected rather
// than returned at the first one, because a file with two typos in its header
// should be fixed once.
func parseAdr(file, src string) (catalog.Adr, []string) {
	p := &parser{
		file:  file,
		lines: strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n"),
	}
	p.read()
	if len(p.errs) > 0 {
		return catalog.Adr{}, p.errs
	}

	return p.adr, nil
}

func (p *parser) fail(line int, msg string) {
	p.errs = append(p.errs, p.file+":"+strconv.Itoa(line+1)+": "+msg)
}

func (p *parser) read() {
	p.adr.Source = p.file
	p.adr.Relates = catalog.AdrRelates{}

	head := p.title()
	if head < 0 {
		return
	}
	p.checkFileName()

	body := p.meta(head + 1)
	if body < 0 {
		return
	}
	p.adr.Body = strings.TrimSpace(strings.Join(p.lines[body:], "\n")) + "\n"
}

// title reads the one line the record has to open with and answers with its
// index, or -1 when there is nothing to go on.
func (p *parser) title() int {
	for i, line := range p.lines {
		if strings.TrimSpace(line) == "" {
			continue
		}

		match := titleLine.FindStringSubmatch(line)
		if match == nil {
			p.fail(i, `a record opens with "# <id> — <title>", an em dash between the two`)

			return -1
		}

		id := adrID.FindStringSubmatch(match[1])
		if id == nil {
			p.fail(i, "the id "+strconv.Quote(match[1])+` is not a prefix and a number, as in "auth.0003"`)

			return -1
		}
		number, err := strconv.Atoi(id[2])
		if err != nil || fmt.Sprintf("%04d", number) != id[2] {
			// The app fails the whole catalog on an id that does not end with
			// its own number, so the digits are the number and are written
			// the one way that round-trips.
			p.fail(i, "the number in "+strconv.Quote(match[1])+" is not four padded digits")

			return -1
		}

		p.adr.ID = match[1]
		p.adr.Number = number
		p.adr.Title = strings.TrimSpace(match[2])

		return i
	}

	p.fail(0, "the file is empty")

	return -1
}

// checkFileName ties the record to the file it is in. The slug is built from
// both - the id says which record this is, the file's name says what it was
// about - so a file renamed away from its record would silently change the
// URL of a decision somebody linked to.
func (p *parser) checkFileName() {
	base := strings.TrimSuffix(path.Base(p.file), ".md")

	match := fileName.FindStringSubmatch(base)
	if match == nil {
		p.fail(0, "the file is named "+strconv.Quote(base+".md")+`, not "NNNN-kebab-slug.md"`)

		return
	}
	if number, _ := strconv.Atoi(match[1]); number != p.adr.Number {
		p.fail(0, "the file is numbered "+match[1]+" and the record inside it is "+p.adr.ID)

		return
	}

	p.adr.Slug = strings.ReplaceAll(p.adr.ID, ".", "-") + "-" + match[2]
}

// meta reads the bullets between the title and the record, and answers with
// the index the record starts at, or -1 when there is none.
func (p *parser) meta(from int) int {
	seen := map[string]bool{}
	key, value, at := "", "", 0
	flush := func() {
		if key != "" {
			p.bullet(at, key, value)
		}
		key, value = "", ""
	}

	for i := from; i < len(p.lines); i++ {
		line := p.lines[i]
		switch {
		case bodyStart.MatchString(line):
			flush()
			p.require(from-1, seen)

			return i

		case strings.TrimSpace(line) == "":
			flush()

		case bulletLine.MatchString(line):
			flush()
			match := bulletLine.FindStringSubmatch(line)
			key, value, at = strings.TrimSpace(match[1]), match[2], i
			if seen[key] {
				p.fail(i, strconv.Quote(key)+" is written twice")
			}
			seen[key] = true

		case key != "" && (strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t")):
			// A bullet wraps onto the next line, indented under itself. The
			// break is the author's line width and means nothing, so it
			// closes up into a space.
			value = strings.TrimSpace(value + " " + strings.TrimSpace(line))

		default:
			p.fail(i, "only meta bullets belong between the title and the first `##`")

			return -1
		}
	}

	flush()
	p.fail(len(p.lines)-1, "the record has no body: nothing here is under a `##`")

	return -1
}

// require reports the three bullets a record cannot be read without. They are
// reported against the title rather than against the missing line, because
// there is no missing line to point at.
func (p *parser) require(at int, seen map[string]bool) {
	for _, key := range []string{"Status", "Date", "Scope"} {
		if !seen[key] {
			p.fail(at, "the record says no "+strconv.Quote(key))
		}
	}

	// Supersession is a two-way fact and half of it recorded is a bug. The
	// other half - that the record named actually names this one back - can
	// only be checked once every record is read, so it is checked there.
	if p.adr.Status == catalog.AdrSuperseded && p.adr.SupersededBy == "" {
		p.fail(at, "the record is superseded and says by what")
	}
	if p.adr.SupersededBy != "" && p.adr.Status != catalog.AdrSuperseded {
		p.fail(at, "the record is superseded by "+p.adr.SupersededBy+` but its status is "`+string(p.adr.Status)+`"`)
	}
}

func (p *parser) bullet(at int, key, value string) {
	switch key {
	case "Status":
		status, ok := statuses[value]
		if !ok {
			p.fail(at, strconv.Quote(value)+" is not a status: proposed, accepted, superseded, deprecated or rejected")

			return
		}
		p.adr.Status = status

	case "Date":
		if _, err := time.Parse("2006-01-02", value); err != nil {
			p.fail(at, strconv.Quote(value)+" is not a date, as in 2026-08-22")

			return
		}
		p.adr.Date = value

	case "Scope":
		p.scope(at, value)

	case "Superseded by":
		if ids := p.ids(at, key, value); len(ids) > 1 {
			p.fail(at, "a record is superseded by one record, not "+strconv.Itoa(len(ids)))
		} else if len(ids) == 1 {
			p.adr.SupersededBy = ids[0]
		}

	case "Supersedes":
		p.adr.Supersedes = p.ids(at, key, value)

	case "Relates":
		p.relates(at, value)

	case "Note":
		p.adr.Note = value

	default:
		p.fail(at, strconv.Quote(key)+" is not one of the bullets a record carries")
	}
}

// scope says what the record is about, and the number of segments says which
// of the three kinds it is: none for the organisation, one for a context, two
// for a service. Whether the thing named exists is not a question this side
// can answer - an extractor sees one service's tree - so it is left to the
// validator, which sees the merged catalog.
func (p *parser) scope(at int, value string) {
	if value == "" || value == "org" {
		p.adr.Scope = catalog.AdrScope{Kind: "org"}

		return
	}
	if !scopeValue.MatchString(value) {
		p.fail(at, strconv.Quote(value)+` is not a scope: "org", a context, or "<context>.<service>"`)

		return
	}
	if strings.Contains(value, ".") {
		p.adr.Scope = catalog.AdrScope{Kind: "service", Service: value}

		return
	}
	p.adr.Scope = catalog.AdrScope{Kind: "context", Context: value}
}

// relates names events, services and flows in one comma-separated list and
// they are told apart by their shape: a flow by its slug, which has no dots; a
// service by `<context>.<service>`; an event by the aggregate and Name after
// that. A name matching none of the three is a typo, and reported here rather
// than left to come back from the validator as a reference to something that
// does not exist.
func (p *parser) relates(at int, value string) {
	for _, id := range split(value) {
		switch {
		case eventID.MatchString(id):
			p.adr.Relates.Events = append(p.adr.Relates.Events, id)
		case serviceID.MatchString(id):
			p.adr.Relates.Services = append(p.adr.Relates.Services, id)
		case flowSlug.MatchString(id):
			p.adr.Relates.Flows = append(p.adr.Relates.Flows, id)
		default:
			p.fail(at, strconv.Quote(id)+" is not the shape of an event, a service or a flow")
		}
	}
}

func (p *parser) ids(at int, key, value string) []string {
	var ids []string
	for _, id := range split(value) {
		if !adrID.MatchString(id) {
			p.fail(at, strconv.Quote(id)+" in "+strconv.Quote(key)+" is not a record's id")

			continue
		}
		ids = append(ids, id)
	}

	return ids
}

func split(value string) []string {
	var out []string
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}

	return out
}
