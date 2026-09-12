package verifyotel

import (
	"strconv"

	"github.com/shortlink-org/portolan/catalog"
)

// visit is one hop of one recording, on its way to becoming a step: the
// hop, the example the recording is being read into, and where in that
// example the step's id goes once there is one.
type visit struct {
	h  hop
	ex *example
	at int
}

// route is what one recording showed through one region of a flow: the
// whole sequence for an observed flow, the hops after one declared step
// for an overlay. An empty route is a recording that showed nothing there,
// which is a fact about the region and is counted.
type route []visit

// ids mints step and frame ids for what the recordings put into a flow.
type ids struct {
	step, frame   string
	steps, frames int
}

func (m *ids) nextStep() string {
	m.steps++

	return m.step + strconv.Itoa(m.steps)
}

func (m *ids) nextFrame() string {
	m.frames++

	return m.frame + strconv.Itoa(m.frames)
}

// build lays the routes over each other into steps and frames. What every
// route shows first is a run of plain steps; where they part is an `alt`
// with one branch per way they went, each branch built the same way; what
// they all show again after parting comes after the frame, once. A route
// that ends where others go on is the branch that shows nothing, and it is
// in the frame too, so that a reader sees the hop is not always taken.
//
// note says what to write on a step that fewer than all routes showed;
// seen is how many did, of total.
func build(routes []route, mint *ids, note func(seen, total int) string) catalog.FlowNodes {
	return buildOver(routes, mint, note, len(routes))
}

func buildOver(routes []route, mint *ids, note func(seen, total int) string, total int) catalog.FlowNodes {
	out := catalog.FlowNodes{}
	if len(routes) == 0 {
		return out
	}
	n := len(routes)

	// The prefix: as far as every route says the same thing.
	p := 0
	for agree(routes, func(r route) (string, bool) {
		if p < len(r) {
			return r[p].h.key(), true
		}

		return "", false
	}) {
		out = append(out, step(routes, func(r route) visit { return r[p] }, mint, note, n, total))
		p++
	}
	rest := make([]route, n)
	empty := true
	for i, r := range routes {
		rest[i] = r[p:]
		if len(rest[i]) > 0 {
			empty = false
		}
	}
	if empty {
		return out
	}

	// The suffix: as far back from the end as every route says the same
	// thing again. A route that has nothing left has no suffix, and then
	// nobody has one.
	s := 0
	for agree(rest, func(r route) (string, bool) {
		if s < len(r) {
			return r[len(r)-1-s].h.key(), true
		}

		return "", false
	}) {
		s++
	}

	// The middle: where the routes part, grouped by the first hop each
	// takes, in the order the groups were first seen.
	type group struct {
		key    string
		routes []route
	}
	var groups []*group
	byKey := map[string]*group{}
	for _, r := range rest {
		middle := r[:len(r)-s]
		key := ""
		if len(middle) > 0 {
			key = middle[0].h.key()
		}
		g := byKey[key]
		if g == nil {
			g = &group{key: key}
			byKey[key] = g
			groups = append(groups, g)
		}
		g.routes = append(g.routes, middle)
	}

	switch {
	case len(groups) == 1 && groups[0].key != "":
		// Everybody goes the same way, which the prefix would have taken
		// had the suffix not claimed part of it. One step, then the rest.
		out = append(out, step(groups[0].routes, func(r route) visit { return r[0] }, mint, note, n, total))
		shorter := make([]route, len(groups[0].routes))
		for i, r := range groups[0].routes {
			shorter[i] = r[1:]
		}
		out = append(out, buildOver(shorter, mint, note, total)...)
	case len(groups) > 1:
		frame := &catalog.Alt{Type: "alt", ID: mint.nextFrame()}
		for _, g := range groups {
			branch := catalog.AltBranch{Title: "otherwise", Steps: catalog.FlowNodes{}, Seen: &catalog.StepSeen{Traces: len(g.routes)}}
			if g.key != "" {
				branch.Title = branchTitle(g.routes[0][0].h)
				branch.Steps = buildOver(g.routes, mint, note, total)
			}
			frame.Branches = append(frame.Branches, branch)
		}
		out = append(out, frame)
	}

	// The suffix, once, after the frame.
	for k := s; k > 0; k-- {
		at := k
		out = append(out, step(rest, func(r route) visit { return r[len(r)-at] }, mint, note, n, total))
	}

	return out
}

// agree says whether every route answers the same thing, and answers it.
func agree(routes []route, ask func(route) (string, bool)) bool {
	first := ""
	for i, r := range routes {
		key, ok := ask(r)
		if !ok {
			return false
		}
		if i == 0 {
			first = key
		} else if key != first {
			return false
		}
	}

	return len(routes) > 0
}

// step writes one hop every route showed as a step, names it on every
// route's example, and counts the routes.
func step(routes []route, pick func(route) visit, mint *ids, note func(seen, total int) string, seen, total int) *catalog.Step {
	first := pick(routes[0]).h
	id := mint.nextStep()
	out := &catalog.Step{
		Type: "step", ID: id, From: first.from.ID, To: first.to.ID,
		Kind: first.kind, Ref: first.ref, Label: first.label, Status: first.status,
		Seen: &catalog.StepSeen{Traces: seen},
	}
	if seen < total && note != nil {
		out.Note = note(seen, total)
	}
	for _, r := range routes {
		v := pick(r)
		if v.ex != nil && v.at >= 0 && v.at < len(v.ex.steps) {
			v.ex.steps[v.at].Step = id
		}
	}

	return out
}

// branchTitle names a branch by the hop it starts with.
func branchTitle(h hop) string {
	if h.label != "" {
		return h.label
	}
	if h.ref != "" {
		return h.ref
	}

	return string(h.kind)
}

// lanesOf is every participant the built nodes need, in the order they are
// first needed.
func lanesOf(nodes catalog.FlowNodes, routes []route) []catalog.Participant {
	var lanes []catalog.Participant
	held := map[string]bool{}
	byID := map[string]catalog.Participant{}
	for _, r := range routes {
		for _, v := range r {
			byID[v.h.from.ID] = v.h.from
			byID[v.h.to.ID] = v.h.to
		}
	}
	walkSteps(nodes, func(s *catalog.Step) {
		for _, id := range []string{s.From, s.To} {
			if !held[id] {
				held[id] = true
				lanes = append(lanes, byID[id])
			}
		}
	})

	return lanes
}
