package main

import (
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// The format, in one place.
//
//	# Order accepted                          the name; the slug is the file's
//	owner: shop                               the context that owns the flow
//	source: services/oms/test/x_test.go       where it was read from; the file itself when left out
//	slug: order-accepted                      only when the file's name is not it
//
//	One or more paragraphs of summary.
//
//	## Participants
//	- oms-db: store in shop "oms-db (postgres)"
//	- psp-gateway: external "psp-gateway (external)"
//
//	## Steps
//	shop.oms -> oms-db: insertOrderAndOutboxRow [verified] @order_repo.go:141 #a1
//	  > A note, as many lines as it takes.
//	shop.oms -> bus: event shop.oms.order.OrderPlaced [verified]
//	shop.oms -> shop.pricing: rpc shop.v1.Pricing/GetQuote as "GetQuote (250 ms)"
//	alt score below 40 #alt-risk
//	  ...
//	else score at or above 40
//	  ...
//	  stop
//	else
//	end
//	par OrderPlaced fan-out
//	  ...
//	and
//	  ...
//	end
//	loop until the batch is empty
//	  ...
//	end
//
// A hop is `from -> to: [call|rpc|event] label-or-ref`, `call` when no kind is
// written, and after it in any order: `as "label"`, `[status]`, `@file:line`,
// `#id`. An event's or rpc's label is the last segment of its ref unless `as`
// says otherwise. `stop` ends the alt branch it is in - the flow does not
// continue past the frame on that path. `else` with no condition is
// "otherwise". Services are known by their `context.service` id, `bus` and
// `client` by their names; anything else is declared under Participants, in
// the order the lanes should be drawn. Lines starting with `//` are comments.

type parser struct {
	file  string
	lines []string
	errs  []string

	flow      catalog.Flow
	declared  []catalog.Participant
	lanes     map[string]catalog.Participant
	used      []catalog.Participant
	ids       map[string]bool
	n         int
	stack     []*frame
	last      *catalog.Step // for notes
	stopped   bool          // the current alt branch has ended
	hasSteps  bool
	sawTitle  bool
	sawOwner  bool
	sawSource bool
}

// frame is an open alt, par or loop and the branch of it being read.
type frame struct {
	kind string
	id   string
	// title is the frame's own, for a par or a loop; current is the branch
	// being read, for an alt, where every branch has a condition.
	title   string
	current string
	alt     []catalog.AltBranch
	par     []catalog.FlowNodes
	steps   catalog.FlowNodes
}

var (
	titleLine  = regexp.MustCompile(`^#\s+(.+?)\s*$`)
	metaLine   = regexp.MustCompile(`^(owner|source|slug):\s*(.*?)\s*$`)
	partLine   = regexp.MustCompile(`^-\s+([^\s:]+):\s*(actor|service|broker|store|external|unknown)(?:\s+in\s+([^\s"]+))?(?:\s+"([^"]*)")?\s*$`)
	stepLine   = regexp.MustCompile(`^([^\s>]+)\s*->\s*([^\s:]+):\s*(.*)$`)
	idSuffix   = regexp.MustCompile(`\s+#(\S+)\s*$`)
	kindPrefix = regexp.MustCompile(`^(call|rpc|event)\s+(.*)$`)
)

func parseFlow(file, src string) (catalog.Flow, []string) {
	p := &parser{
		file:  file,
		lines: strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n"),
		lanes: map[string]catalog.Participant{},
		ids:   map[string]bool{},
	}
	p.read()
	if len(p.errs) > 0 {
		return catalog.Flow{}, p.errs
	}

	return p.flow, nil
}

func (p *parser) fail(line int, msg string) {
	p.errs = append(p.errs, p.file+":"+strconv.Itoa(line+1)+": "+msg)
}

func (p *parser) read() {
	section := "head"
	var summary []string
	var paragraph []string
	flush := func() {
		if len(paragraph) > 0 {
			summary = append(summary, strings.Join(paragraph, " "))
			paragraph = nil
		}
	}

	for i, raw := range p.lines {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "//") {
			continue
		}

		switch {
		case strings.HasPrefix(line, "## "):
			flush()
			switch strings.ToLower(strings.TrimSpace(line[3:])) {
			case "participants":
				section = "participants"
			case "steps":
				section = "steps"
			default:
				p.fail(i, "unknown section "+strconv.Quote(line[3:])+"; the sections are Participants and Steps")
			}

			continue
		case section == "head":
			p.head(i, line, &paragraph, flush)
		case section == "participants":
			p.participant(i, line)
		case section == "steps":
			p.step(i, line)
		}
	}
	flush()

	if !p.sawTitle {
		p.fail(0, "no title: the first line names the flow, as `# Name`")
	}
	if !p.sawOwner {
		p.fail(0, "no owner: say which context the flow belongs to, as `owner: <context>`")
	}
	if !p.hasSteps {
		p.fail(0, "no steps: a flow is at least one hop under `## Steps`")
	}
	for _, f := range p.stack {
		p.fail(len(p.lines)-1, f.kind+" is never closed; every frame ends with `end`")
	}
	if len(p.errs) > 0 {
		return
	}

	p.flow.Summary = strings.Join(summary, "\n\n")
	if p.flow.Slug == "" {
		base := path.Base(p.file)
		p.flow.Slug = strings.TrimSuffix(strings.TrimSuffix(base, ".md"), ".flow")
	}
	p.flow.ID = "flow." + p.flow.Slug
	if !p.sawSource {
		p.flow.Source = p.file
	}
	p.flow.Participants = append(append([]catalog.Participant{}, p.declared...), p.used...)
	if p.flow.Participants == nil {
		p.flow.Participants = []catalog.Participant{}
	}
}

func (p *parser) head(i int, line string, paragraph *[]string, flush func()) {
	if line == "" {
		flush()

		return
	}
	if m := titleLine.FindStringSubmatch(line); m != nil && !p.sawTitle {
		p.flow.Name = m[1]
		p.sawTitle = true

		return
	}
	if m := metaLine.FindStringSubmatch(line); m != nil && len(*paragraph) == 0 {
		switch m[1] {
		case "owner":
			p.flow.Owner = m[2]
			p.sawOwner = true
		case "source":
			p.flow.Source = m[2]
			p.sawSource = true
		case "slug":
			p.flow.Slug = m[2]
		}

		return
	}
	*paragraph = append(*paragraph, line)
}

func (p *parser) participant(i int, line string) {
	if line == "" {
		return
	}
	m := partLine.FindStringSubmatch(line)
	if m == nil {
		p.fail(i, "not a participant: write `- <id>: <kind> [in <context>] [\"label\"]`, with kind one of actor, service, broker, store, external, unknown")

		return
	}
	id, kind, context, label := m[1], m[2], m[3], m[4]
	if _, dup := p.lanes[id]; dup {
		p.fail(i, "participant "+id+" is declared twice")

		return
	}
	lane := catalog.Participant{ID: id, Kind: catalog.ParticipantKind(kind), Label: label}
	if kind == "service" && context == "" {
		context, _, _ = strings.Cut(id, ".")
	}
	if context != "" {
		lane.Context = &context
	}
	p.lanes[id] = lane
	p.declared = append(p.declared, lane)
}

// lane resolves a name in a step to a participant: declared, or inferable -
// `bus` is the broker, `context.service` is a service.
func (p *parser) lane(i int, id string) (string, bool) {
	if _, ok := p.lanes[id]; ok {
		return id, true
	}
	var lane catalog.Participant
	switch {
	case id == "bus":
		lane = catalog.Participant{ID: id, Kind: catalog.ParticipantBroker}
	case id == "client":
		lane = catalog.Participant{ID: id, Kind: catalog.ParticipantActor}
	case strings.Count(id, ".") == 1 && !strings.HasPrefix(id, ".") && !strings.HasSuffix(id, "."):
		context, _, _ := strings.Cut(id, ".")
		lane = catalog.Participant{ID: id, Kind: catalog.ParticipantService, Context: &context}
	default:
		p.fail(i, "participant "+strconv.Quote(id)+" is not declared, and is neither a service (context.service) nor the bus")

		return "", false
	}
	p.lanes[id] = lane
	p.used = append(p.used, lane)

	return id, true
}

// sink is where the next node goes: the open frame's branch, or the flow.
func (p *parser) sink() *catalog.FlowNodes {
	if len(p.stack) == 0 {
		return &p.flow.Steps
	}

	return &p.stack[len(p.stack)-1].steps
}

func (p *parser) nextID(prefix string, explicit string, i int) string {
	id := explicit
	if id == "" {
		p.n++
		id = prefix + strconv.Itoa(p.n)
	}
	if p.ids[id] {
		p.fail(i, "id "+id+" is used twice")
	}
	p.ids[id] = true

	return id
}

func (p *parser) step(i int, line string) {
	if line == "" {
		return
	}

	// A note continues the step above it.
	if strings.HasPrefix(line, ">") {
		text := strings.TrimSpace(strings.TrimPrefix(line, ">"))
		if p.last == nil {
			p.fail(i, "a note (`> ...`) has to follow the step it is about")

			return
		}
		if text == "" {
			return
		}
		if p.last.Note == "" {
			p.last.Note = text
		} else {
			p.last.Note += " " + text
		}

		return
	}

	word, rest, _ := strings.Cut(line, " ")
	rest = strings.TrimSpace(rest)
	switch word {
	case "alt", "par", "loop":
		title, id := splitID(rest)
		if word == "loop" && title == "" {
			p.fail(i, "a loop needs a title saying what it repeats until")
		}
		p.last = nil
		p.stopped = false
		p.stack = append(p.stack, &frame{kind: word, id: p.nextID(word, id, i), title: title, current: title})

		return
	case "else", "and":
		f := p.open(i, word)
		if f == nil {
			return
		}
		p.branch(f)
		f.current = rest
		p.last = nil
		p.stopped = false

		return
	case "stop":
		f := p.open(i, "stop")
		if f == nil {
			return
		}
		p.stopped = true
		p.last = nil

		return
	case "end":
		if len(p.stack) == 0 {
			p.fail(i, "`end` with no frame open")

			return
		}
		f := p.stack[len(p.stack)-1]
		p.branch(f)
		p.stack = p.stack[:len(p.stack)-1]
		p.close(i, f)
		p.last = nil
		p.stopped = false

		return
	}

	if p.stopped {
		p.fail(i, "nothing runs after `stop`; it ends the branch")

		return
	}
	m := stepLine.FindStringSubmatch(line)
	if m == nil {
		p.fail(i, "not a step: write `from -> to: [call|rpc|event] label`, or alt/else/par/and/loop/stop/end")

		return
	}
	from, okFrom := p.lane(i, m[1])
	to, okTo := p.lane(i, m[2])
	if !okFrom || !okTo {
		return
	}
	step := p.hop(i, m[3])
	if step == nil {
		return
	}
	step.From, step.To = from, to
	*p.sink() = append(*p.sink(), step)
	p.last = step
	p.hasSteps = true
}

// open is the innermost frame `else`, `and` or `stop` belongs to, checked to
// be the right kind.
func (p *parser) open(i int, word string) *frame {
	if len(p.stack) == 0 {
		p.fail(i, "`"+word+"` outside any frame")

		return nil
	}
	f := p.stack[len(p.stack)-1]
	want := map[string]string{"else": "alt", "and": "par", "stop": "alt"}[word]
	if f.kind != want {
		p.fail(i, "`"+word+"` inside a "+f.kind+"; it belongs to an "+want)

		return nil
	}

	return f
}

// branch closes the branch being read and starts the next.
func (p *parser) branch(f *frame) {
	steps := f.steps
	if steps == nil {
		steps = catalog.FlowNodes{}
	}
	switch f.kind {
	case "alt":
		title := f.current
		if len(f.alt) > 0 && title == "" {
			title = "otherwise"
		}
		f.alt = append(f.alt, catalog.AltBranch{Title: title, Steps: steps, Terminal: p.stopped})
	case "par":
		f.par = append(f.par, steps)
	case "loop":
		f.steps = steps

		return
	}
	f.steps = nil
	f.current = ""
}

// close turns a finished frame into its node and appends it where it belongs.
func (p *parser) close(i int, f *frame) {
	var node catalog.FlowNode
	switch f.kind {
	case "alt":
		if len(f.alt) < 2 {
			p.fail(i, "an alt states a choice and needs an `else`; a branch with nothing in it is fine")
		}
		if f.alt[0].Title == "" {
			p.fail(i, "the first branch of an alt needs a condition: `alt <when>`")
		}
		all := len(f.alt) > 0
		for _, b := range f.alt {
			if !b.Terminal {
				all = false
			}
		}
		if all {
			p.fail(i, "every branch of this alt stops; the flow cannot end on every path of a choice about what comes next")
		}
		node = &catalog.Alt{Type: "alt", ID: f.id, Branches: f.alt}
	case "par":
		if len(f.par) < 2 {
			p.fail(i, "a par runs branches side by side and needs an `and`")
		}
		node = &catalog.Parallel{Type: "parallel", ID: f.id, Title: f.title, Branches: f.par}
	case "loop":
		node = &catalog.Loop{Type: "loop", ID: f.id, Title: f.title, Steps: f.steps}
	}
	*p.sink() = append(*p.sink(), node)
	p.hasSteps = p.hasSteps || f.kind == "loop"
}

// hop reads what follows `from -> to:`.
func (p *parser) hop(i int, rest string) *catalog.Step {
	// The label runs up to the first trailer: ` as "`, ` [`, ` @`, ` #`.
	head, tail := rest, ""
	cut := len(rest)
	for _, marker := range []string{` as "`, ` [`, ` @`, ` #`} {
		if at := strings.Index(rest, marker); at >= 0 && at < cut {
			cut = at
		}
	}
	if cut < len(rest) {
		head, tail = rest[:cut], rest[cut+1:]
	}
	head = strings.TrimSpace(head)

	kind := catalog.StepCall
	if m := kindPrefix.FindStringSubmatch(head); m != nil {
		kind = catalog.StepKind(m[1])
		head = strings.TrimSpace(m[2])
	}
	if head == "" {
		p.fail(i, "a step needs a label, or a ref for an event or rpc")

		return nil
	}

	step := &catalog.Step{Type: "step", Kind: kind, Status: catalog.StatusDeclared}
	switch kind {
	case catalog.StepEvent:
		step.Ref = head
		step.Label = head[strings.LastIndex(head, ".")+1:]
	case catalog.StepRPC:
		// A ref is `<package.Service>/<Method>`, one word with a dot before
		// the slash. `POST /webhooks/psp/v2` is a label: a route a webhook
		// arrives on, which no interface in the catalog declares.
		if isCallID(head) {
			step.Ref = head
			step.Label = head[strings.LastIndex(head, "/")+1:]
		} else {
			step.Label = head
		}
	default:
		step.Label = head
	}

	// Each trailer runs to the next marker, so a source location may have
	// spaces in it: `@trace 9f2c1a../span 04` is where a step read from a
	// trace was seen, and it is not a file:line.
	var explicit string
	for _, part := range trailers(tail) {
		switch {
		case strings.HasPrefix(part, "as \""):
			label, after, closed := strings.Cut(part[4:], "\"")
			if !closed || strings.TrimSpace(after) != "" {
				p.fail(i, "cannot read "+strconv.Quote(part)+"; a label after `as` is closed by its quote and followed by nothing")

				return nil
			}
			step.Label = label
		case strings.HasPrefix(part, "["):
			status, after, closed := strings.Cut(part[1:], "]")
			if !closed || strings.TrimSpace(after) != "" {
				p.fail(i, "cannot read "+strconv.Quote(part)+"; a status is one word in brackets and followed by nothing")

				return nil
			}
			switch catalog.Status(status) {
			case catalog.StatusVerified, catalog.StatusDeclared, catalog.StatusUnresolved:
				step.Status = catalog.Status(status)
			default:
				p.fail(i, "status ["+status+"] is not one of verified, declared, unresolved")
			}
		case strings.HasPrefix(part, "@"):
			step.Line = strings.TrimSpace(part[1:])
		case strings.HasPrefix(part, "#"):
			explicit = strings.TrimSpace(part[1:])
		default:
			p.fail(i, "cannot read "+strconv.Quote(part)+" after the label; what may follow is as \"label\", [status], @file:line and #id")

			return nil
		}
	}
	step.ID = p.nextID("s", explicit, i)

	return step
}

func isCallID(s string) bool {
	slash := strings.Index(s, "/")

	return slash > 0 && !strings.ContainsAny(s, " \t") && strings.Contains(s[:slash], ".") && slash < len(s)-1
}

// trailers splits what follows a label at its markers, keeping each marker
// on the piece it starts.
func trailers(tail string) []string {
	tail = strings.TrimSpace(tail)
	if tail == "" {
		return nil
	}
	var out []string
	for tail != "" {
		cut := len(tail)
		for _, marker := range []string{` as "`, ` [`, ` @`, ` #`} {
			if at := strings.Index(tail, marker); at >= 0 && at < cut {
				cut = at
			}
		}
		out = append(out, strings.TrimSpace(tail[:cut]))
		if cut == len(tail) {
			break
		}
		tail = strings.TrimSpace(tail[cut:])
	}

	return out
}

// splitID takes a trailing `#id` off a frame's header.
func splitID(rest string) (string, string) {
	if m := idSuffix.FindStringSubmatch(" " + rest); m != nil {
		return strings.TrimSpace(strings.TrimSuffix(rest, m[0][1:])), m[1]
	}

	return strings.TrimSpace(rest), ""
}
