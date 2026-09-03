package main

import (
	"go/ast"
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
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
// runs once per session has been told something false.
func TestCallSitesCarryTheLoopTheySitIn(t *testing.T) {
	_, end := handleOf(t, useCaseSource, "end")

	for _, site := range callSites(end) {
		selector, ok := site.call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "Save" {
			continue
		}
		if site.note != "inside a loop over `retries`" {
			t.Fatalf("Save note = %q", site.note)
		}

		return
	}

	t.Fatal("no Save call found")
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
