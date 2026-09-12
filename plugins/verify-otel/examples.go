package verifyotel

import (
	"math"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"time"

	"github.com/shortlink-org/portolan/catalog"
)

// defaultExamples is how many recordings a flow keeps as examples when the
// manifest does not say: enough to show a happy path and a refusal or two,
// few enough that a day of production traffic does not become the page.
const defaultExamples = 5

// clockEpoch is the start a span must be past to have been stamped by a
// clock: 2000-01-01 in unix nanoseconds. A recording written by hand, or by
// a test, counts from a small number, and that is not a time.
const clockEpoch = 946684800 * 1e9

// exampleAttrs is every span attribute an example may carry. Names, verbs,
// routes and codes are what a reader wants next to a step; a query text, a
// header, a full URL or a path with an id in it is somebody's data, and the
// catalog is published. The list is closed on purpose: a new attribute is
// added here, with the argument for it, or it is not carried.
var exampleAttrs = map[string]bool{
	"http.request.method":        true,
	"http.route":                 true,
	"http.response.status_code":  true,
	"rpc.system":                 true,
	"rpc.service":                true,
	"rpc.method":                 true,
	"rpc.grpc.status_code":       true,
	"db.system.name":             true,
	"db.system":                  true,
	"db.operation.name":          true,
	"db.operation":               true,
	"db.collection.name":         true,
	"db.namespace":               true,
	"messaging.system":           true,
	"messaging.destination.name": true,
	"messaging.operation.type":   true,
	"messaging.operation":        true,
	"event.name":                 true,
	"server.address":             true,
	"server.port":                true,
}

// example is one trace, being read into the steps it showed.
type example struct {
	root    string // the step's input root, relative to the repository
	file    string // the recording, relative to the root
	traceID string
	start   uint64
	end     uint64
	steps   []catalog.ExampleStep
}

func newExample(inputRoot string, root *span) *example {
	return &example{root: inputRoot, file: root.file, traceID: root.traceID, start: root.start, end: root.end}
}

// add records what a span said about the step it was read as.
func (e *example) add(stepID string, s *span) {
	if s == nil {
		return
	}
	if s.end > e.end {
		e.end = s.end
	}
	e.steps = append(e.steps, catalog.ExampleStep{
		Step:       stepID,
		Label:      s.name,
		DurationMs: millis(s.start, s.end),
		Attributes: stepAttrs(s),
	})
}

func (e *example) id() string {
	return e.file + "#" + e.traceID
}

func (e *example) finish() catalog.FlowExample {
	out := catalog.FlowExample{
		ID:         e.id(),
		Recording:  path.Join(filepath.ToSlash(e.root), e.file),
		TraceID:    e.traceID,
		DurationMs: millis(e.start, e.end),
		Steps:      e.steps,
	}
	if e.start > clockEpoch {
		out.RecordedAt = time.Unix(0, int64(e.start)).UTC().Format(time.RFC3339Nano)
	}
	if out.Steps == nil {
		out.Steps = []catalog.ExampleStep{}
	}

	return out
}

// pickExamples keeps the recordings that show the most of a flow, the
// earliest first among equals, up to the limit. Stable across runs: two
// files that say the same thing pick the same traces.
func pickExamples(all []*example, limit int) []catalog.FlowExample {
	if limit <= 0 || len(all) == 0 {
		return nil
	}
	sorted := append([]*example(nil), all...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if len(a.steps) != len(b.steps) {
			return len(a.steps) > len(b.steps)
		}
		if a.start != b.start {
			return a.start < b.start
		}

		return a.id() < b.id()
	})
	if len(sorted) > limit {
		sorted = sorted[:limit]
	}
	out := make([]catalog.FlowExample, 0, len(sorted))
	for _, e := range sorted {
		out = append(out, e.finish())
	}

	return out
}

func stepAttrs(s *span) map[string]string {
	var out map[string]string
	for key, value := range s.attrs {
		if !exampleAttrs[key] || value == "" {
			continue
		}
		if out == nil {
			out = map[string]string{}
		}
		out[key] = value
	}

	return out
}

// millis is a span's length in milliseconds, to the microsecond, or zero
// for a recording without a clock.
func millis(start, end uint64) float64 {
	if end <= start {
		return 0
	}

	return math.Round(float64(end-start)/1e3) / 1e3
}

// seenStep is a hop a recording showed, counted across recordings, on its
// way to becoming a step: an addition to a declared flow, or a step of an
// observed one.
type seenStep struct {
	hop    hop
	traces int
	id     string
}

func (s *seenStep) step() *catalog.Step {
	h := s.hop

	return &catalog.Step{
		Type: "step", ID: s.id, From: h.from.ID, To: h.to.ID,
		Kind: h.kind, Ref: h.ref, Label: h.label, Status: h.status,
		Seen: &catalog.StepSeen{Traces: s.traces},
	}
}

// sequence is hops laid over each other across recordings: a hop already
// held is counted, a new one is put after the last hop matched, so that two
// recordings that differ in the middle read as one order.
type sequence struct {
	steps []*seenStep
	next  int
}

// absorb lays one recording's hops over the sequence, counting each hop
// once per recording, and tells the example which step each span became.
func (q *sequence) absorb(hops []hop, ex *example) {
	counted := map[string]bool{}
	at := -1
	for _, h := range hops {
		key := h.key()
		found := -1
		for j, s := range q.steps {
			if s.hop.key() == key {
				found = j

				break
			}
		}
		if found < 0 {
			q.next++
			s := &seenStep{hop: h, id: "s" + strconv.Itoa(q.next)}
			at++
			rest := append([]*seenStep{s}, q.steps[at:]...)
			q.steps = append(q.steps[:at], rest...)
			found = at
		} else {
			at = found
		}
		if !counted[key] {
			counted[key] = true
			q.steps[found].traces++
		}
		if ex != nil {
			ex.add(q.steps[found].id, h.span)
		}
	}
}
