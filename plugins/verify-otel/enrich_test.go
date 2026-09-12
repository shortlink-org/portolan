package verifyotel

import (
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// runVerifyAt is runVerify that also says where the recording was laid.
func runVerifyAt(t *testing.T, traces string, opts Options) (catalog.Catalog, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "telemetry"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "telemetry/traces.jsonl"), []byte(traces), 0o644); err != nil {
		t.Fatal(err)
	}
	opts.Traces = []string{"telemetry/*.jsonl"}
	resp, err := verify(plugin.Request{Catalog: estate(), Input: plugin.Input{Root: root}}, opts)
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}

	return out, root
}

// A second recording of the login: this one is refused by risk and takes
// the blocked arm, and it carries a clock. And a second health check, one
// that also publishes - a shape the first health check did not have.
const second = `{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"auth"}}]},"scopeSpans":[{"spans":[
 {"traceId":"t5","spanId":"e1","name":"POST /v1/sessions","kind":2,"startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000000002600000","attributes":[{"key":"http.route","value":{"stringValue":"/v1/sessions"}},{"key":"http.request.method","value":{"stringValue":"POST"}},{"key":"http.response.status_code","value":{"intValue":"403"}},{"key":"url.path","value":{"stringValue":"/v1/sessions"}}]},
 {"traceId":"t5","spanId":"e2","parentSpanId":"e1","name":"SELECT users","kind":3,"startTimeUnixNano":"1700000000000100000","endTimeUnixNano":"1700000000000400000","attributes":[{"key":"db.system.name","value":{"stringValue":"postgresql"}},{"key":"db.operation.name","value":{"stringValue":"SELECT"}},{"key":"db.query.text","value":{"stringValue":"SELECT * FROM users WHERE email = 'ann@example.com'"}}]},
 {"traceId":"t5","spanId":"e3","parentSpanId":"e1","name":"risk.v1.RiskService/Assess","kind":3,"startTimeUnixNano":"1700000000000500000","endTimeUnixNano":"1700000000002000000","attributes":[{"key":"rpc.system","value":{"stringValue":"grpc"}},{"key":"rpc.service","value":{"stringValue":"risk.v1.RiskService"}},{"key":"rpc.method","value":{"stringValue":"Assess"}}]},
 {"traceId":"t5","spanId":"e4","parentSpanId":"e1","name":"publish auth.SessionEnded","kind":4,"startTimeUnixNano":"1700000000002100000","endTimeUnixNano":"1700000000002500000","attributes":[{"key":"event.name","value":{"stringValue":"auth.SessionEnded"}},{"key":"messaging.destination.name","value":{"stringValue":"auth_session"}}]},

 {"traceId":"t6","spanId":"f1","name":"GET /v1/health","kind":2,"startTimeUnixNano":"1700000000010000000","endTimeUnixNano":"1700000000011000000","attributes":[{"key":"http.route","value":{"stringValue":"/v1/health"}},{"key":"http.request.method","value":{"stringValue":"GET"}}]},
 {"traceId":"t6","spanId":"f2","parentSpanId":"f1","name":"SELECT 1","kind":3,"startTimeUnixNano":"1700000000010100000","endTimeUnixNano":"1700000000010200000","attributes":[{"key":"db.system.name","value":{"stringValue":"postgresql"}},{"key":"db.operation.name","value":{"stringValue":"SELECT"}}]},
 {"traceId":"t6","spanId":"f3","parentSpanId":"f1","name":"publish auth.SessionStarted","kind":4,"startTimeUnixNano":"1700000000010300000","endTimeUnixNano":"1700000000010400000","attributes":[{"key":"event.name","value":{"stringValue":"auth.SessionStarted"}}]}
]}]}]}`

func seenOf(flow catalog.Flow) map[string]int {
	out := map[string]int{}
	walkSteps(flow.Steps, func(s *catalog.Step) {
		if s.Seen != nil {
			out[s.ID] = s.Seen.Traces
		}
	})

	return out
}

// Two recordings of one flow are laid over each other: every step counts
// the recordings that showed it, a hop only one of them showed says so,
// and the flow is one flow, not one per recording.
func TestTwoRecordingsOfOneFlowAreLaidOverEachOther(t *testing.T) {
	out, _ := runVerify(t, recording+"\n"+second, Options{})

	login := flowNamed(t, out, "auth-login")
	seen := seenOf(login)
	want := map[string]int{"s1": 2, "s3": 2, "seen1": 1, "seen2": 1, "s5": 1, "s6": 1}
	for id, n := range want {
		if seen[id] != n {
			t.Errorf("%s seen in %d recordings, want %d", id, seen[id], n)
		}
	}
	got := statuses(login)
	if got["s5"] != catalog.StatusVerified || got["s6"] != catalog.StatusVerified {
		t.Errorf("both arms ran, once each: %v", got)
	}
	var note string
	walkSteps(login.Steps, func(s *catalog.Step) {
		if s.ID == "seen1" {
			note = s.Note
		}
	})
	if !strings.Contains(note, "1 recording of 2 traces") {
		t.Errorf("note = %q, want how many recordings showed the added hop", note)
	}
	if n := strings.Count(strings.Join(slugs(out), " "), "auth-login"); n != 1 {
		t.Errorf("the login is one flow, found %d", n)
	}
}

// Two recordings that open the same undeclared way are one observed flow.
// Where they part - one published after its query, one did not - is a
// frame with a branch for each way, the way that went no further included.
func TestObservedRecordingsThatOpenAlikeAreOneFlow(t *testing.T) {
	out, _ := runVerify(t, recording+"\n"+second, Options{})

	health := flowNamed(t, out, "observed-auth-get-v1-health")
	if len(health.Steps) != 3 {
		t.Fatalf("steps = %+v", health.Steps)
	}
	var labels []string
	for _, node := range health.Steps[:2] {
		labels = append(labels, node.(*catalog.Step).Label)
	}
	if strings.Join(labels, " ") != "GET /v1/health SELECT" {
		t.Errorf("shared steps = %v", labels)
	}
	frame, ok := health.Steps[2].(*catalog.Alt)
	if !ok || frame.ID != "alt1" || len(frame.Branches) != 2 {
		t.Fatalf("where the recordings part should be a frame: %+v", health.Steps[2])
	}
	first, second := frame.Branches[0], frame.Branches[1]
	if first.Title != "otherwise" || len(first.Steps) != 0 || first.Seen == nil || first.Seen.Traces != 1 {
		t.Errorf("the recording that stopped after the query: %+v", first)
	}
	if second.Title != "SessionStarted" || len(second.Steps) != 1 || second.Seen == nil || second.Seen.Traces != 1 {
		t.Errorf("the recording that published: %+v", second)
	}
	seen := seenOf(health)
	if seen["s1"] != 2 || seen["s2"] != 2 || seen["s3"] != 1 {
		t.Errorf("seen = %v", seen)
	}
	if !strings.Contains(health.Summary, "2 traces") {
		t.Errorf("summary = %q", health.Summary)
	}
}

// Where recordings of a declared flow part after a declared step, what they
// showed there is a frame hung after it: the login that was let through
// called two more services, the login that was refused called none.
func TestRecordingsThatPartAfterADeclaredStepAreAFrame(t *testing.T) {
	out, _ := runVerify(t, recording+"\n"+second, Options{})

	login := flowNamed(t, out, "auth-login")
	var frame *catalog.Alt
	for i, node := range login.Steps {
		if a, ok := node.(*catalog.Alt); ok && strings.HasPrefix(a.ID, "seen-alt") {
			frame = a
			if prev, ok := login.Steps[i-1].(*catalog.Step); !ok || prev.ID != "s3" {
				t.Errorf("the frame hangs after the step the recordings parted at, not %+v", login.Steps[i-1])
			}
		}
	}
	if frame == nil || len(frame.Branches) != 2 {
		t.Fatalf("no frame for the two ways the recordings went: %+v", login.Steps)
	}
	through, refused := frame.Branches[0], frame.Branches[1]
	if through.Title != "getUser" || len(through.Steps) != 2 || through.Seen.Traces != 1 {
		t.Errorf("the way through: %+v", through)
	}
	if refused.Title != "otherwise" || len(refused.Steps) != 0 || refused.Seen.Traces != 1 {
		t.Errorf("the way refused: %+v", refused)
	}
	var ids []string
	walkSteps(login.Steps, func(s *catalog.Step) { ids = append(ids, s.ID) })
	if strings.Join(ids, " ") != "s1 s2 s3 seen1 seen2 s5 s6" {
		t.Errorf("ids = %v", ids)
	}
	// The example of the refused login names no step inside the frame.
	for _, ex := range login.Examples {
		for _, s := range ex.Steps {
			if s.Step == "" {
				t.Errorf("example %s has a step with no id: %+v", ex.ID, s)
			}
		}
	}
}

// What runs under a consumer is the consumer's flow. The password change
// shows the event leaving and arriving, and nothing of what the policy did
// with it: that is the revoke flow's, and it is raised there.
func TestAConsumersWorkStaysOutOfTheRequestsFlow(t *testing.T) {
	out, _ := runVerify(t, recording, Options{})

	change := flowNamed(t, out, "observed-auth-changepassword")
	var order []string
	walkSteps(change.Steps, func(s *catalog.Step) { order = append(order, s.From+">"+s.To+":"+s.Label) })
	want := "client>auth.auth:changePassword auth.auth>bus:PasswordChanged bus>auth.auth:PasswordChanged"
	if strings.Join(order, " ") != want {
		t.Errorf("steps = %v\nwant    %s", order, want)
	}
	revoke := flowNamed(t, out, "auth-revoke")
	if got := statuses(revoke); got["s3"] != catalog.StatusVerified {
		t.Errorf("the policy's publish is raised on the policy's flow: %v", got)
	}
}

// A recording is kept as an example of the flow: which steps it showed, how
// long each took, and the names the spans carried - never the query, never
// the path, never a value that could be somebody's.
func TestARecordingIsKeptAsAnExampleWithoutAnybodysData(t *testing.T) {
	out, root := runVerifyAt(t, recording+"\n"+second, Options{})

	login := flowNamed(t, out, "auth-login")
	if len(login.Examples) != 2 {
		t.Fatalf("examples = %+v", login.Examples)
	}
	// The recording that showed the most of the flow comes first.
	if login.Examples[0].TraceID != "t1" || login.Examples[1].TraceID != "t5" {
		t.Errorf("order = %s, %s", login.Examples[0].TraceID, login.Examples[1].TraceID)
	}
	// The recording is named from the repository, the way every source in
	// the catalog is; the id stays relative to the step, which is what is
	// stable when a project moves.
	refused := login.Examples[1]
	if refused.ID != "telemetry/traces.jsonl#t5" || refused.Recording != path.Join(filepath.ToSlash(root), "telemetry/traces.jsonl") {
		t.Errorf("example = %+v", refused)
	}
	if refused.RecordedAt != "2023-11-14T22:13:20Z" || refused.DurationMs != 2.6 {
		t.Errorf("clock = %s for %v ms", refused.RecordedAt, refused.DurationMs)
	}
	var steps []string
	for _, s := range refused.Steps {
		steps = append(steps, s.Step)
	}
	if strings.Join(steps, " ") != "s1 s3 s5" {
		t.Errorf("steps = %v", steps)
	}
	entry := refused.Steps[0]
	if entry.Attributes["http.route"] != "/v1/sessions" || entry.Attributes["http.response.status_code"] != "403" {
		t.Errorf("entry = %+v", entry)
	}
	if _, leaked := entry.Attributes["url.path"]; leaked {
		t.Errorf("a path is not carried: %+v", entry)
	}
	if refused.Steps[1].DurationMs != 1.5 || refused.Steps[1].Label != "risk.v1.RiskService/Assess" {
		t.Errorf("rpc = %+v", refused.Steps[1])
	}

	first := login.Examples[0]
	for _, s := range first.Steps {
		for key := range s.Attributes {
			if key == "url.full" || key == "db.query.text" {
				t.Errorf("%s carried on %s", key, s.Step)
			}
		}
		if s.Step == "seen1" && s.Attributes["server.address"] != "auth" {
			t.Errorf("the host of the call is a name and is carried: %+v", s)
		}
	}
	if first.RecordedAt != "" {
		t.Errorf("a recording without a clock has no time: %q", first.RecordedAt)
	}

	health := flowNamed(t, out, "observed-auth-get-v1-health")
	if len(health.Examples) != 2 || health.Examples[0].TraceID != "t6" {
		t.Errorf("an observed flow keeps its recordings too, fullest first: %+v", health.Examples)
	}
}

// The manifest says how many examples a flow keeps; zero is none.
func TestTheManifestSaysHowManyExamplesToKeep(t *testing.T) {
	one := 1
	out, _ := runVerify(t, recording+"\n"+second, Options{Examples: &one})
	if n := len(flowNamed(t, out, "auth-login").Examples); n != 1 {
		t.Errorf("examples = %d, want 1", n)
	}
	none := 0
	out, _ = runVerify(t, recording+"\n"+second, Options{Examples: &none})
	for _, f := range out.Flows {
		if len(f.Examples) != 0 {
			t.Errorf("%s keeps examples with none asked for", f.Slug)
		}
	}
}
