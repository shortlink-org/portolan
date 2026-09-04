package main

import (
	"go/ast"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// The flows themselves are checked where every other fragment is: the committed
// examples/auth/portolan/domain.json, which `npm run gen:check` holds to the
// source. What is worth pinning here is the reading that gets there - the order
// calls come out in, what a signature says came back, and the two places where
// a wrong answer would be a plausible one.

const useCaseSource = `package end_after_credential_change

import (
	"context"

	"github.com/example/auth/internal/domain/session"
	"github.com/example/auth/internal/domain/session/event"
)

type UseCase struct {
	repo session.Repository
	now  func() time.Time
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	sessions, err := uc.repo.ByUserID(ctx, in.UserID)
	if err != nil {
		return err
	}

	for _, doomed := range change.Ends(sessions, uc.now()) {
		if err := uc.end(ctx, doomed.ID); err != nil {
			return err
		}
	}
	return nil
}

func (uc *UseCase) end(ctx context.Context, id string) error {
	for attempt := range retries {
		current, err := uc.repo.ByID(ctx, id)
		if err != nil {
			return err
		}

		ev, ended := current.Revoke(event.ReasonPasswordChanged, uc.now())
		if !ended {
			return nil
		}

		return uc.repo.Save(ctx, current, ev)
	}
	return nil
}
`

func handleOf(t *testing.T, source, name string) (*pkg, *ast.FuncDecl) {
	t.Helper()

	pkg, err := parseSource("usecase.go", source)
	if err != nil {
		t.Fatal(err)
	}

	fn := pkg.methods("UseCase")[name]
	if fn == nil {
		t.Fatalf("no method %s on UseCase", name)
	}

	return pkg, fn
}

// The order of the calls is the order of the flow, and it has to be the order
// they are written in - including a call in an `if` initialiser, which runs
// before the block it guards.
func TestCallSitesAreInSourceOrder(t *testing.T) {
	_, handle := handleOf(t, useCaseSource, "Handle")

	var got []string
	for _, site := range callSites(handle) {
		if selector, ok := site.call.Fun.(*ast.SelectorExpr); ok {
			got = append(got, selector.Sel.Name)
		}
	}

	want := []string{"ByUserID", "Ends", "now", "end"}
	if len(got) != len(want) {
		t.Fatalf("calls = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("call %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// A step inside a loop says so. The frame is deliberately not built - the
// condition is written for a compiler - but a reader who is not told that Save
// runs once per session has been told something false. The note travels from
// the loop in Handle, through the helper it calls, onto the step.
func TestAStepInsideALoopSaysSo(t *testing.T) {
	d, _ := walkSource(t, useCaseSource, nil)

	save := stepLabelled(t, d.steps, "Save")
	want := "inside a loop over `change.Ends(sessions, uc.now())`, inside a loop over `retries`."
	if save.Note != want {
		t.Fatalf("Save note = %q, want %q", save.Note, want)
	}
}

// walkSource reads Handle of an in-memory use case the way extractFlows would,
// with the store on its own lane and the given peers.
func walkSource(t *testing.T, source string, peers map[string]string) (*flowDraft, *flowReader) {
	t.Helper()

	pkg, handle := handleOf(t, source, "Handle")
	r := newFlowReader(t.TempDir(), flowOptions{context: "auth", svcID: "auth.auth", service: "auth", store: "pg", peers: peers}, &plugin.Builder{})
	r.module = "github.com/example/auth"

	d := newDraft()
	d.lane(r.serviceLane())
	r.walkBody(d, &scope{
		pkg:      pkg,
		key:      "session/login",
		fields:   useCaseFields(pkg),
		imports:  importsOf(pkg),
		vars:     map[string]domainRef{},
		recv:     receiverIdent(handle),
		recvType: "UseCase",
	}, handle, 0)

	return d, r
}

func stepLabelled(t *testing.T, nodes catalog.FlowNodes, label string) *catalog.Step {
	t.Helper()
	for _, node := range nodes {
		switch x := node.(type) {
		case *catalog.Step:
			if x.Label == label {
				return x
			}
		case *catalog.Alt:
			for _, branch := range x.Branches {
				for _, inner := range branch.Steps {
					if step, ok := inner.(*catalog.Step); ok && step.Label == label {
						return step
					}
				}
			}
		}
	}
	t.Fatalf("no step labelled %s", label)

	return nil
}

const branchingSource = `package login

import (
	"context"

	"github.com/example/auth/internal/domain/session"
)

type UseCase struct {
	repo session.Repository
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	u, err := uc.repo.ByID(ctx, in.ID)
	if err != nil {
		return err
	}

	if in.Force {
		if err := uc.repo.Save(ctx, u); err != nil {
			return err
		}
		return nil
	} else if in.Dry {
		uc.repo.ByToken(ctx, in.Token)
	}

	return uc.repo.Save(ctx, u)
}
`

// An if with a hop inside it is a choice the reader has to see, and an arm
// that returns is one the flow does not continue past. The if with nothing in
// it - the error check - is not drawn at all.
func TestAnIfWithAHopInsideItIsAnAlt(t *testing.T) {
	d, _ := walkSource(t, branchingSource, nil)

	if len(d.steps) != 3 {
		t.Fatalf("top-level nodes = %d, want 3 (ByID, alt, Save): %s", len(d.steps), dump(d.steps))
	}
	alt, ok := d.steps[1].(*catalog.Alt)
	if !ok {
		t.Fatalf("second node is %T, want alt", d.steps[1])
	}
	if alt.ID != "alt4" {
		t.Errorf("alt id = %q; ids number every node, frames included", alt.ID)
	}

	type arm struct {
		title    string
		steps    int
		terminal bool
	}
	var got []arm
	for _, b := range alt.Branches {
		got = append(got, arm{b.Title, len(b.Steps), b.Terminal})
	}
	want := []arm{{"in.Force", 1, true}, {"in.Dry", 1, false}, {"otherwise", 0, false}}
	if len(got) != len(want) {
		t.Fatalf("arms = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("arm %d = %+v, want %+v", i, got[i], want[i])
		}
	}

	last, ok := d.steps[2].(*catalog.Step)
	if !ok || last.Label != "Save" || last.ID != "s5" {
		t.Errorf("last node = %+v, want the Save after the alt as s5", d.steps[2])
	}
}

// Two arms that both end the flow are not a choice about what comes next, and
// the catalog refuses an alt whose every arm leaves. The arms stay drawn; the
// mark comes off.
func TestArmsThatAllLeaveLoseTheMark(t *testing.T) {
	const source = `package login

import "github.com/example/auth/internal/domain/session"

type UseCase struct {
	repo session.Repository
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	if in.A {
		return uc.repo.Save(ctx, nil)
	} else {
		return uc.repo.ByID(ctx, in.ID)
	}
}
`
	d, _ := walkSource(t, source, nil)
	alt, ok := d.steps[0].(*catalog.Alt)
	if !ok {
		t.Fatalf("node = %T", d.steps[0])
	}
	for _, branch := range alt.Branches {
		if branch.Terminal {
			t.Errorf("arm %q is terminal", branch.Title)
		}
	}
}

func dump(nodes catalog.FlowNodes) string {
	out := ""
	for _, node := range nodes {
		switch x := node.(type) {
		case *catalog.Step:
			out += x.ID + ":" + x.Label + " "
		case *catalog.Alt:
			out += x.ID + "{" + dump(altSteps(x)) + "} "
		}
	}

	return out
}

func altSteps(alt *catalog.Alt) catalog.FlowNodes {
	var out catalog.FlowNodes
	for _, b := range alt.Branches {
		out = append(out, b.Steps...)
	}

	return out
}

// The loops enclosing a call travel into the body it reaches: a use case run
// once per session does everything it does once per session, and the fact
// belongs to its steps rather than to the call that got there.
func TestLoopsTravelIntoTheBodyTheyReach(t *testing.T) {
	d := &flowDraft{seen: map[string]bool{}}
	d.enter("inside a loop over `sessions`")
	d.enter("inside a loop over `retries`")
	d.add(catalog.Step{Label: "Save"})
	d.leave()
	d.leave()

	step, ok := d.steps[0].(*catalog.Step)
	if !ok {
		t.Fatalf("step is %T", d.steps[0])
	}
	want := "inside a loop over `sessions`, inside a loop over `retries`."
	if step.Note != want {
		t.Errorf("note = %q, want %q", step.Note, want)
	}
}

// What came back is read off the signature, by position: a name bound to the
// second result of `Start` holds an event, and one bound to the first holds a
// session. Reading the body instead would be reading an implementation to find
// out what a declaration already says.
func TestResultsAreReadOffTheSignature(t *testing.T) {
	const domainSource = `package session

import "github.com/example/auth/internal/domain/session/event"

func Start(id, userID string, now time.Time) (*Session, event.SessionStarted, error) {
	return nil, event.SessionStarted{}, nil
}
`

	pkg, err := parseSource("session.go", domainSource)
	if err != nil {
		t.Fatal(err)
	}

	var start *ast.FuncDecl
	for _, decl := range pkg.files[0].Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Name.Name == "Start" {
			start = fn
		}
	}
	if start == nil {
		t.Fatal("no Start")
	}

	r := &flowReader{}
	got := r.resultRefs(pkg, "session", start.Type)

	if len(got) != 3 {
		t.Fatalf("results = %d, want 3 - a result this cannot place has to keep its position", len(got))
	}
	if got[0].name != "Session" || got[0].event {
		t.Errorf("first result = %+v", got[0])
	}
	if got[1].name != "SessionStarted" || !got[1].event || got[1].aggregate != "session" {
		t.Errorf("second result = %+v", got[1])
	}
	if got[2].name != "" {
		t.Errorf("error was read as %+v", got[2])
	}
}

// The binding lives in assembly because neither side of it can: login declares
// the port so that it does not import the package that satisfies it.
func TestPortBindingsAreReadFromAssembly(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "internal/di/provider")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	const provider = `package provider

import (
	"github.com/example/auth/internal/application/session/usecases/login"
	"github.com/example/auth/internal/application/user/usecases/authenticate"
)

func ProvideAuthenticator(uc *authenticate.UseCase) login.Authenticator {
	return authenticator{uc: uc}
}

// Two results is not a binding: the port is not the whole answer.
func ProvideSomethingElse(uc *authenticate.UseCase) (login.Authenticator, error) {
	return nil, nil
}
`
	if err := os.WriteFile(filepath.Join(dir, "authenticator.go"), []byte(provider), 0o644); err != nil {
		t.Fatal(err)
	}

	got := portBindings(root)
	if want := "user/authenticate"; got["session/login.Authenticator"] != want {
		t.Errorf("binding = %q, want %q", got["session/login.Authenticator"], want)
	}
	if len(got) != 1 {
		t.Errorf("bindings = %v, want exactly the one that binds two use cases", got)
	}
}

// An import of the domain is a lane; the event package under it is a fact.
// Nothing else is either, and a reader that guessed would put a helper package
// on a diagram as if it were a database.
func TestPackagesAreToldApart(t *testing.T) {
	imports := map[string]string{
		"session": "github.com/example/auth/internal/domain/session",
		"event":   "github.com/example/auth/internal/domain/session/event",
		"uc":      "github.com/example/auth/internal/application/user/usecases/authenticate",
		"time":    "time",
	}

	if aggregate, name, ok := domainSelector("session.Repository", imports); !ok || aggregate != "session" || name != "Repository" {
		t.Errorf("domainSelector = %q %q %v", aggregate, name, ok)
	}
	if _, _, ok := domainSelector("time.Time", imports); ok {
		t.Error("time.Time was read as a domain port")
	}
	if aggregate, ok := eventPackage(imports["event"]); !ok || aggregate != "session" {
		t.Errorf("eventPackage = %q %v", aggregate, ok)
	}
	if _, ok := eventPackage(imports["session"]); ok {
		t.Error("the aggregate package was read as its event package")
	}
	if key, ok := useCaseSelector("*uc.UseCase", imports); !ok || key != "user/authenticate" {
		t.Errorf("useCaseSelector = %q %v", key, ok)
	}
}

func TestSentence(t *testing.T) {
	if got := sentence("revoke-sessions-on-password-change"); got != "Revoke sessions on password change" {
		t.Errorf("sentence = %q", got)
	}
}

// A switch is a choice too. Its arms are titled by what the case says, with
// the subject in front; default is otherwise; an arm that returns is
// terminal; and, like an if, nothing is drawn unless some arm has a hop.
func TestASwitchWithAHopIsAnAlt(t *testing.T) {
	const source = `package login

import (
	"context"

	"github.com/example/auth/internal/domain/session"
)

type UseCase struct {
	repo session.Repository
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	u, err := uc.repo.ByID(ctx, in.ID)
	if err != nil {
		return err
	}
	switch in.Mode {
	case "soft", "gentle":
		return uc.repo.Save(ctx, u)
	case "hard":
		uc.repo.ByToken(ctx, in.Token)
	default:
		return nil
	}
	switch {
	case in.A > 1:
		return nil
	case in.B:
		return nil
	}
	return nil
}
`
	d, _ := walkSource(t, source, nil)
	if got := dump(d.steps); got != "s1:ByID alt4{s2:Save s3:ByToken } " {
		t.Fatalf("nodes = %q; the second switch has no hop and is not drawn", got)
	}
	alt := d.steps[1].(*catalog.Alt)
	var titles []string
	for _, b := range alt.Branches {
		titles = append(titles, b.Title)
	}
	if strings.Join(titles, "|") != `in.Mode is "soft", "gentle"|in.Mode is "hard"|otherwise` {
		t.Errorf("titles = %q", titles)
	}
	if !alt.Branches[0].Terminal || alt.Branches[1].Terminal || !alt.Branches[2].Terminal {
		t.Errorf("terminal = %v %v %v", alt.Branches[0].Terminal, alt.Branches[1].Terminal, alt.Branches[2].Terminal)
	}
}

// A type switch asks about one value, and every arm says what it turned out
// to be.
func TestATypeSwitchNamesWhatItAsksAbout(t *testing.T) {
	const source = `package login

import "github.com/example/auth/internal/domain/session"

type UseCase struct {
	repo session.Repository
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	switch e := in.Event.(type) {
	case *Started, *Renewed:
		return uc.repo.Save(ctx, nil)
	case *Ended:
		uc.repo.ByID(ctx, e.ID)
	}
	return nil
}
`
	d, _ := walkSource(t, source, nil)
	alt, ok := d.steps[0].(*catalog.Alt)
	if !ok {
		t.Fatalf("node = %T", d.steps[0])
	}
	if alt.Branches[0].Title != "in.Event is *Started, *Renewed" || alt.Branches[1].Title != "in.Event is *Ended" || alt.Branches[2].Title != "otherwise" {
		t.Errorf("titles = %q %q %q", alt.Branches[0].Title, alt.Branches[1].Title, alt.Branches[2].Title)
	}
}
