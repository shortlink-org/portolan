package verifyotel

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

// A route spelled as letters: each letter one hop, keyed by itself.
func spell(letters string) route {
	r := route{}
	for _, c := range letters {
		label := string(c)
		r = append(r, visit{h: hop{
			from: catalog.Participant{ID: "a"}, to: catalog.Participant{ID: "b"},
			kind: catalog.StepRPC, ref: "rpc." + label, label: label, status: catalog.StatusVerified,
		}, at: -1})
	}

	return r
}

// shape writes built nodes back as text: steps by label with their count,
// frames as [branch | branch] with each branch's title and count.
func shape(nodes catalog.FlowNodes) string {
	var parts []string
	for _, node := range nodes {
		switch n := node.(type) {
		case *catalog.Step:
			parts = append(parts, n.Label+"×"+itoa(n.Seen.Traces))
		case *catalog.Alt:
			var branches []string
			for _, b := range n.Branches {
				branches = append(branches, b.Title+"×"+itoa(b.Seen.Traces)+"("+shape(b.Steps)+")")
			}
			parts = append(parts, "["+strings.Join(branches, " | ")+"]")
		}
	}

	return strings.Join(parts, " ")
}

func itoa(n int) string {
	return strings.TrimSpace(strings.Repeat(" ", 0) + string(rune('0'+n)))
}

func TestRoutesAreLaidOverEachOther(t *testing.T) {
	cases := []struct {
		name   string
		routes []string
		want   string
	}{
		{"one recording is its own sequence", []string{"abc"}, "a×1 b×1 c×1"},
		{"recordings that agree are one sequence, counted", []string{"abc", "abc", "abc"}, "a×3 b×3 c×3"},
		{"recordings that part are a frame after what they share", []string{"abx", "aby"}, "a×2 b×2 [x×1(x×1) | y×1(y×1)]"},
		{"a recording that stops where another goes on is the branch that shows nothing", []string{"ab", "abx"}, "a×2 b×2 [otherwise×1() | x×1(x×1)]"},
		{"what they show again after parting comes after the frame, once", []string{"axz", "ayz"}, "a×2 [x×1(x×1) | y×1(y×1)] z×2"},
		{"a hop one of them skips is a frame with an empty branch, and the rest follows", []string{"abz", "az"}, "a×2 [b×1(b×1) | otherwise×1()] z×2"},
		{"a branch parts again inside", []string{"axp", "axq", "ay"}, "a×3 [x×2(x×2 [p×1(p×1) | q×1(q×1)]) | y×1(y×1)]"},
		{"three ways, in the order first seen", []string{"ay", "ax", "az", "ax"}, "a×4 [y×1(y×1) | x×2(x×2) | z×1(z×1)]"},
		{"a route that goes round twice keeps its order", []string{"abab", "ab"}, "a×2 b×2 [a×1(a×1 b×1) | otherwise×1()]"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			routes := make([]route, 0, len(tc.routes))
			for _, r := range tc.routes {
				routes = append(routes, spell(r))
			}
			got := shape(build(routes, &ids{step: "s", frame: "alt"}, nil))
			if got != tc.want {
				t.Errorf("\ngot  %s\nwant %s", got, tc.want)
			}
		})
	}
}

// Ids are minted in the order the steps are written, frames apart from
// steps, and every step names the example it came from.
func TestBuiltStepsAreNamedInOrderAndOnTheirExamples(t *testing.T) {
	ex := &example{}
	a := spell("axz")
	b := spell("ayz")
	for i := range a {
		a[i].ex = ex
		a[i].at = ex.reserve(&span{name: "a" + a[i].h.label})
	}
	nodes := build([]route{a, b}, &ids{step: "seen", frame: "seen-alt"}, func(seen, total int) string { return "some" })

	var ids []string
	walkSteps(nodes, func(s *catalog.Step) { ids = append(ids, s.ID) })
	if strings.Join(ids, " ") != "seen1 seen2 seen3 seen4" {
		t.Errorf("ids = %v", ids)
	}
	if frame, ok := nodes[1].(*catalog.Alt); !ok || frame.ID != "seen-alt1" {
		t.Errorf("frame = %+v", nodes[1])
	}
	var named []string
	for _, s := range ex.steps {
		named = append(named, s.Step)
	}
	// a, then x (the first branch), then z after the frame.
	if strings.Join(named, " ") != "seen1 seen2 seen4" {
		t.Errorf("example steps = %v", named)
	}
	var notes []string
	walkSteps(nodes, func(s *catalog.Step) { notes = append(notes, s.Label+":"+s.Note) })
	if strings.Join(notes, " ") != "a: x:some y:some z:" {
		t.Errorf("only a step fewer than all showed carries the note: %v", notes)
	}
}
