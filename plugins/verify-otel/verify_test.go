package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// The catalog the traces are read against: one service, two aggregates, an
// endpoint flow read from code and a policy flow that opens on the bus.
func estate() catalog.Catalog {
	auth := "auth"
	step := func(id, from, to string, kind catalog.StepKind, label, ref string) *catalog.Step {
		return &catalog.Step{Type: "step", ID: id, From: from, To: to, Kind: kind, Label: label, Ref: ref, Status: catalog.StatusDeclared}
	}
	lanes := []catalog.Participant{
		{ID: "client", Kind: catalog.ParticipantActor},
		{ID: "auth.auth", Kind: catalog.ParticipantService, Context: &auth},
		{ID: "auth-pg", Kind: catalog.ParticipantStore, Context: &auth},
		{ID: "bus", Kind: catalog.ParticipantBroker},
	}

	return catalog.Catalog{
		GeneratedAt: "2026-01-01T00:00:00Z",
		Commit:      "abc1234",
		Defs:        map[string]catalog.TypeDef{},
		Adrs:        []catalog.Adr{},
		Contexts: []catalog.BoundedContext{{
			ID: "auth", Slug: "auth", Name: "Authentication",
			Services: []catalog.Service{{
				ID: "auth.auth", Slug: "auth", Name: "Auth",
				Provides: []catalog.RpcService{{
					ID: "auth.v1.Sessions",
					Methods: []catalog.RpcMethod{
						{Name: "login", HTTP: &catalog.HttpRoute{Method: "POST", Path: "/v1/sessions"}},
						{Name: "changePassword", HTTP: &catalog.HttpRoute{Method: "POST", Path: "/v1/users/me/password"}},
						{Name: "getUser", HTTP: &catalog.HttpRoute{Method: "GET", Path: "/v1/users/{userId}"}},
					},
				}},
				Consumes: []catalog.RpcCall{{ID: "risk.v1.RiskService/Assess", Peer: "risk.v1", Status: catalog.StatusUnresolved, Source: "gen"}},
				Aggregates: []catalog.Aggregate{
					{ID: "auth.auth.session", Slug: "session", Name: "Session", Root: "Session", Events: []catalog.Event{
						{ID: "auth.auth.session.SessionStarted", Slug: "session-started", Name: "SessionStarted", Versions: []catalog.EventVersion{{Version: "v1"}}, Consumers: []catalog.EventConsumer{}},
						{ID: "auth.auth.session.SessionEnded", Slug: "session-ended", Name: "SessionEnded", Versions: []catalog.EventVersion{{Version: "v1"}}, Consumers: []catalog.EventConsumer{}},
					}},
					{ID: "auth.auth.user", Slug: "user", Name: "User", Root: "User", Events: []catalog.Event{
						{ID: "auth.auth.user.PasswordChanged", Slug: "password-changed", Name: "PasswordChanged", Versions: []catalog.EventVersion{{Version: "v1"}}, Consumers: []catalog.EventConsumer{{Service: "auth.auth", Status: catalog.StatusDeclared}}},
					}},
				},
			}},
		}},
		Stores: []catalog.Store{{ID: "auth.auth.pg", Slug: "pg", Name: "Auth database", Kind: catalog.StoreKindPostgres, Owner: "auth.auth"}},
		Flows: []catalog.Flow{
			{
				ID: "flow.auth-login", Slug: "auth-login", Name: "Login", Owner: "auth", Participants: lanes,
				Steps: catalog.FlowNodes{
					step("s1", "client", "auth.auth", catalog.StepRPC, "login", ""),
					step("s2", "auth.auth", "auth-pg", catalog.StepCall, "ByEmail", ""),
					&catalog.Step{Type: "step", ID: "s3", From: "auth.auth", To: "risk-v1", Kind: catalog.StepRPC, Label: "Assess", Ref: "risk.v1.RiskService/Assess", Status: catalog.StatusUnresolved},
					&catalog.Alt{Type: "alt", ID: "alt4", Branches: []catalog.AltBranch{
						{Title: "blocked", Terminal: true, Steps: catalog.FlowNodes{step("s5", "auth.auth", "bus", catalog.StepEvent, "SessionEnded", "auth.auth.session.SessionEnded")}},
						{Title: "otherwise", Steps: catalog.FlowNodes{}},
					}},
					step("s6", "auth.auth", "bus", catalog.StepEvent, "SessionStarted", "auth.auth.session.SessionStarted"),
				},
			},
			{
				ID: "flow.auth-revoke", Slug: "auth-revoke", Name: "Revoke", Owner: "auth", Participants: lanes,
				Steps: catalog.FlowNodes{
					step("s1", "bus", "auth.auth", catalog.StepEvent, "PasswordChanged", "auth.auth.user.PasswordChanged"),
					step("s2", "auth.auth", "auth-pg", catalog.StepCall, "Save", ""),
					step("s3", "auth.auth", "bus", catalog.StepEvent, "SessionEnded", "auth.auth.session.SessionEnded"),
				},
			},
		},
	}
}

// One batch, written the way a collector writes it: the kinds as numbers
// except one, to show the names are read too.
const recording = `{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"auth"}}]},"scopeSpans":[{"spans":[
 {"traceId":"t1","spanId":"a1","name":"POST /v1/sessions","kind":2,"startTimeUnixNano":"100","attributes":[{"key":"http.route","value":{"stringValue":"/v1/sessions"}},{"key":"http.request.method","value":{"stringValue":"POST"}}]},
 {"traceId":"t1","spanId":"a2","parentSpanId":"a1","name":"SELECT users","kind":3,"startTimeUnixNano":"110","attributes":[{"key":"db.system.name","value":{"stringValue":"postgresql"}},{"key":"db.operation.name","value":{"stringValue":"SELECT"}}]},
 {"traceId":"t1","spanId":"a3","parentSpanId":"a2","name":"prepare SELECT users","kind":3,"startTimeUnixNano":"111","attributes":[{"key":"db.system.name","value":{"stringValue":"postgresql"}},{"key":"db.operation.name","value":{"stringValue":"SELECT"}}]},
 {"traceId":"t1","spanId":"a4","parentSpanId":"a1","name":"risk.v1.RiskService/Assess","kind":3,"startTimeUnixNano":"120","attributes":[{"key":"rpc.system","value":{"stringValue":"grpc"}},{"key":"rpc.service","value":{"stringValue":"risk.v1.RiskService"}},{"key":"rpc.method","value":{"stringValue":"Assess"}}]},
 {"traceId":"t1","spanId":"a6","parentSpanId":"a1","name":"GET","kind":3,"startTimeUnixNano":"125","attributes":[{"key":"http.request.method","value":{"stringValue":"GET"}},{"key":"url.full","value":{"stringValue":"http://auth:8080/v1/users/42?verbose=1"}},{"key":"server.address","value":{"stringValue":"auth"}}]},
 {"traceId":"t1","spanId":"a7","parentSpanId":"a1","name":"GET","kind":3,"startTimeUnixNano":"126","attributes":[{"key":"http.request.method","value":{"stringValue":"GET"}},{"key":"url.full","value":{"stringValue":"http://profile:9000/v1/profiles/42"}},{"key":"server.address","value":{"stringValue":"profile"}}]},
 {"traceId":"t1","spanId":"a5","parentSpanId":"a1","name":"publish auth.SessionStarted","kind":"SPAN_KIND_PRODUCER","startTimeUnixNano":"130","attributes":[{"key":"messaging.destination.name","value":{"stringValue":"auth_session"}},{"key":"event.name","value":{"stringValue":"auth.SessionStarted"}}]},

 {"traceId":"t2","spanId":"b1","name":"POST /v1/users/me/password","kind":2,"startTimeUnixNano":"200","attributes":[{"key":"http.route","value":{"stringValue":"/v1/users/me/password"}},{"key":"http.request.method","value":{"stringValue":"POST"}}]},
 {"traceId":"t2","spanId":"b2","parentSpanId":"b1","name":"publish auth.PasswordChanged","kind":4,"startTimeUnixNano":"210","attributes":[{"key":"event.name","value":{"stringValue":"auth.PasswordChanged"}}]},
 {"traceId":"t2","spanId":"b3","parentSpanId":"b2","name":"consume auth.PasswordChanged","kind":5,"startTimeUnixNano":"220","attributes":[{"key":"event.name","value":{"stringValue":"auth.PasswordChanged"}}]},
 {"traceId":"t2","spanId":"b4","parentSpanId":"b3","name":"UPDATE sessions","kind":3,"startTimeUnixNano":"230","attributes":[{"key":"db.system.name","value":{"stringValue":"postgresql"}},{"key":"db.operation.name","value":{"stringValue":"UPDATE"}}]},
 {"traceId":"t2","spanId":"b5","parentSpanId":"b3","name":"publish auth.SessionEnded","kind":4,"startTimeUnixNano":"240","attributes":[{"key":"event.name","value":{"stringValue":"auth.SessionEnded"}}]},

 {"traceId":"t3","spanId":"c1","name":"GET /v1/health","kind":2,"startTimeUnixNano":"300","attributes":[{"key":"http.route","value":{"stringValue":"/v1/health"}},{"key":"http.request.method","value":{"stringValue":"GET"}}]},
 {"traceId":"t3","spanId":"c2","parentSpanId":"c1","name":"SELECT 1","kind":3,"startTimeUnixNano":"310","attributes":[{"key":"db.system.name","value":{"stringValue":"postgresql"}},{"key":"db.operation.name","value":{"stringValue":"SELECT"}}]}
]}]},
{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"billing"}}]},"scopeSpans":[{"spans":[
 {"traceId":"t4","spanId":"d1","name":"POST /v1/charges","kind":2,"startTimeUnixNano":"400","attributes":[{"key":"http.route","value":{"stringValue":"/v1/charges"}}]}
]}]}]}`

func runVerify(t *testing.T, traces string, opts Options) (catalog.Catalog, plugin.Response) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "telemetry"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "telemetry/traces.jsonl"), []byte(traces), 0o644); err != nil {
		t.Fatal(err)
	}
	if opts.Traces == nil {
		opts.Traces = []string{"telemetry/*.jsonl"}
	}

	resp, err := verify(plugin.Request{Catalog: estate(), Input: plugin.Input{Root: root, Commit: "abc1234", GeneratedAt: "2026-01-01T00:00:00Z"}}, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Files) != 1 || resp.Files[0].Name != "observed.json" {
		t.Fatalf("files = %+v", resp.Files)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatalf("fragment is not a catalog: %v", err)
	}

	return out, resp
}

func flowNamed(t *testing.T, cat catalog.Catalog, slug string) catalog.Flow {
	t.Helper()
	for _, f := range cat.Flows {
		if f.Slug == slug {
			return f
		}
	}
	t.Fatalf("no flow %s in %v", slug, slugs(cat))

	return catalog.Flow{}
}

func slugs(cat catalog.Catalog) []string {
	var out []string
	for _, f := range cat.Flows {
		out = append(out, f.Slug)
	}

	return out
}

func statuses(flow catalog.Flow) map[string]catalog.Status {
	out := map[string]catalog.Status{}
	walkSteps(flow.Steps, func(s *catalog.Step) { out[s.ID] = s.Status })

	return out
}

// A trace that opens on a declared endpoint raises the steps it shows - the
// call in, the events out - and leaves the rest as the code declared them.
// A store call is not raised: a query ran, but nothing in the span says it
// was the repository method the code names.
func TestATraceRaisesTheHopsItShows(t *testing.T) {
	out, resp := runVerify(t, recording, Options{})

	login := flowNamed(t, out, "auth-login")
	got := statuses(login)
	want := map[string]catalog.Status{
		"s1": catalog.StatusVerified,   // client -> auth.auth login
		"s2": catalog.StatusDeclared,   // ByEmail: a SELECT ran, which is not the same claim
		"s3": catalog.StatusUnresolved, // risk: seen, but its far end is still not in the catalog
		"s5": catalog.StatusDeclared,   // the blocked arm did not run
		"s6": catalog.StatusVerified,   // SessionStarted published
	}
	for id, status := range want {
		if got[id] != status {
			t.Errorf("%s = %s, want %s", id, got[id], status)
		}
	}
	first := firstStep(login.Steps)
	if !strings.Contains(first.Note, "telemetry/traces.jsonl") {
		t.Errorf("note = %q, want the recording named", first.Note)
	}
	if len(login.Participants) != 4 {
		t.Errorf("participants changed: %+v", login.Participants)
	}
	for _, d := range resp.Diagnostics {
		if strings.Contains(d.Message, "no service in the catalog") && !strings.Contains(d.Message, "billing") && !strings.Contains(d.Message, "profile") {
			t.Errorf("unexpected diagnostic: %s", d.Message)
		}
	}
}

// A consumer inside a trace is the opening of a flow of its own: the policy
// flow is raised from the middle of the password change, and the consumer
// edge comes out verified.
func TestAConsumerInsideATraceOpensThePolicyFlow(t *testing.T) {
	out, _ := runVerify(t, recording, Options{})

	revoke := flowNamed(t, out, "auth-revoke")
	got := statuses(revoke)
	if got["s1"] != catalog.StatusVerified || got["s3"] != catalog.StatusVerified || got["s2"] != catalog.StatusDeclared {
		t.Errorf("statuses = %v", got)
	}

	var consumers []catalog.EventConsumer
	for _, ctx := range out.Contexts {
		for _, svc := range ctx.Services {
			for _, agg := range svc.Aggregates {
				for _, ev := range agg.Events {
					if ev.ID == "auth.auth.user.PasswordChanged" {
						consumers = ev.Consumers
					}
				}
			}
		}
	}
	if len(consumers) != 1 || consumers[0].Service != "auth.auth" || consumers[0].Status != catalog.StatusVerified {
		t.Errorf("consumers = %+v", consumers)
	}
}

// A call to a service the catalog does not have is recorded as made and still
// unresolved; the peer is the package, on a lane without a dot.
func TestACallToNobodyStaysUnresolved(t *testing.T) {
	out, _ := runVerify(t, recording, Options{})

	var calls []catalog.RpcCall
	for _, ctx := range out.Contexts {
		for _, svc := range ctx.Services {
			if svc.ID == "auth.auth" {
				calls = svc.Consumes
			}
		}
	}
	if len(calls) != 2 || calls[1].ID != "risk.v1.RiskService/Assess" || calls[1].Status != catalog.StatusUnresolved || calls[1].Peer != "risk.v1" {
		t.Errorf("consumes = %+v", calls)
	}
}

// A call over HTTP is read back to the operation whose route it hit, by the
// verb and the path's shape; one no service answers on is a hop to a host.
func TestAnHTTPCallIsNamedByTheRouteItHit(t *testing.T) {
	out, resp := runVerify(t, recording, Options{})

	var calls []catalog.RpcCall
	for _, ctx := range out.Contexts {
		for _, svc := range ctx.Services {
			if svc.ID == "auth.auth" {
				calls = svc.Consumes
			}
		}
	}
	if len(calls) != 2 || calls[0].ID != "auth.v1.Sessions/getUser" || calls[0].Peer != "auth.auth" || calls[0].Status != catalog.StatusVerified {
		t.Errorf("consumes = %+v", calls)
	}
	var warned bool
	for _, d := range resp.Diagnostics {
		if strings.Contains(d.Message, "GET /v1/profiles/42") && strings.Contains(d.Message, "profile") {
			warned = true
		}
	}
	if !warned {
		t.Errorf("a call to a host nobody in the catalog is should be reported: %+v", resp.Diagnostics)
	}
}

// A sequence no flow opens is written down as seen, once per shape, on the
// route it came in on.
func TestASequenceNobodyDeclaredIsObserved(t *testing.T) {
	out, resp := runVerify(t, recording, Options{})

	health := flowNamed(t, out, "observed-auth-get-v1-health")
	if health.Owner != "auth" || len(health.Steps) != 2 {
		t.Fatalf("flow = %+v", health)
	}
	first := firstStep(health.Steps)
	if first.Label != "GET /v1/health" || first.Status != catalog.StatusVerified || first.From != "client" || first.To != "auth.auth" {
		t.Errorf("first = %+v", first)
	}
	second := health.Steps[1].(*catalog.Step)
	if second.To != "auth-pg" || second.Label != "SELECT" {
		t.Errorf("second = %+v", second)
	}
	if !strings.Contains(health.Summary, "1 trace") {
		t.Errorf("summary = %q", health.Summary)
	}

	var warned bool
	for _, d := range resp.Diagnostics {
		if strings.Contains(d.Message, "GET /v1/health") {
			warned = true
		}
	}
	if !warned {
		t.Error("a route no interface declares should be reported")
	}
}

// Spans from a service the catalog does not have are reported once and read
// as nothing: a flow for a service that does not exist would be a service.
func TestAnUnknownServiceIsReportedNotInvented(t *testing.T) {
	out, resp := runVerify(t, recording, Options{})

	for _, slug := range slugs(out) {
		if strings.Contains(slug, "charges") {
			t.Errorf("a flow was written for the unknown service: %s", slug)
		}
	}
	var n int
	for _, d := range resp.Diagnostics {
		if strings.Contains(d.Message, `"billing"`) {
			n++
		}
	}
	if n != 1 {
		t.Errorf("billing was reported %d times, want once", n)
	}

	named, _ := runVerify(t, recording, Options{Services: map[string]string{"billing": "auth.auth"}})
	if len(named.Flows) <= len(out.Flows) {
		t.Error("naming the service under `services` should read its spans")
	}
}

// One batch per line and one value per file are the same recording.
func TestJSONLinesAndOneValueReadAlike(t *testing.T) {
	lines := strings.ReplaceAll(recording, "\n\n", "\n")
	a, err := parseOTLP([]byte(recording), "x")
	if err != nil {
		t.Fatal(err)
	}
	two := strings.Replace(lines, `]}]},
{"resource"`, "]}]}]}\n{\"resourceSpans\":[{\"resource\"", 1)
	b, err := parseOTLP([]byte(two), "x")
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != len(b) || len(a) != 15 {
		t.Errorf("spans = %d and %d, want 15 both ways", len(a), len(b))
	}
	if a[6].kind != kindProducer {
		t.Errorf("kind written as a name = %d", a[6].kind)
	}
}

// The fragment says nothing when there is nothing to read, and says so.
func TestNoRecordingIsAWarningAndAnEmptyFragment(t *testing.T) {
	root := t.TempDir()
	resp, err := verify(plugin.Request{Catalog: estate(), Input: plugin.Input{Root: root}}, Options{Traces: []string{"telemetry/*.jsonl"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Diagnostics) != 1 || !strings.Contains(resp.Diagnostics[0].Message, "no trace files") {
		t.Errorf("diagnostics = %+v", resp.Diagnostics)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil || len(out.Flows) != 0 {
		t.Errorf("fragment = %s", resp.Files[0].Contents)
	}
}

func TestAColonRouteHasTheShapeOfABracedOne(t *testing.T) {
	if shapeOf("/v1/baskets/:basketId/items/:sku") != shapeOf("/v1/baskets/{basketId}/items/{sku}") {
		t.Fatalf("a Fastify route and the OpenAPI path it serves read as different shapes")
	}
	if !routeMatches("/v1/baskets/{basketId}", "/v1/baskets/42") || routeMatches("/v1/baskets/{basketId}", "/v1/baskets") {
		t.Fatalf("routeMatches does not fill a parameter with exactly one segment")
	}
}
