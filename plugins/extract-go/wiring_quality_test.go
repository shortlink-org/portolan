package extractgo

import (
	"go/ast"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func writeQualitySource(t *testing.T, root, name, contents string) {
	t.Helper()
	filename := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filename, []byte(contents), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestAmbiguousProviderKeepsUnresolvedCallInsteadOfFirstCandidate(t *testing.T) {
	for _, params := range []string{"a *first.UseCase, b *second.UseCase", "b *second.UseCase, a *first.UseCase"} {
		t.Run(params, func(t *testing.T) {
			root := t.TempDir()
			writeQualitySource(t, root, "internal/di/provider.go", `package di
import (
 "example.com/app/internal/application/user/usecases/login"
 "example.com/app/internal/application/user/usecases/first"
 "example.com/app/internal/application/user/usecases/second"
)
func Provide(`+params+`) login.Authenticator { return build(a,b) }
`)
			bound, ambiguous := readPortBindings(root)
			if len(bound) != 0 || strings.Join(ambiguous["user/login.Authenticator"], ",") != "user/first,user/second" {
				t.Fatalf("bindings = %v; ambiguous = %v", bound, ambiguous)
			}
			p, err := parseSource("login.go", `package login
type Authenticator interface { Authenticate() }
type UseCase struct { auth Authenticator }
func (u *UseCase) Handle() { u.auth.Authenticate() }
`)
			if err != nil {
				t.Fatal(err)
			}
			b := &plugin.Builder{}
			r := &flowReader{opts: flowOptions{svcID: "app.api"}, b: b, bindings: bound, ambiguousBindings: ambiguous}
			d := newDraft()
			r.walkBody(d, &scope{pkg: p, key: "user/login", fields: useCaseFields(p), imports: map[string]string{}, vars: map[string]domainRef{}, recv: "u", recvType: "UseCase"}, p.methods("UseCase")["Handle"], 0)
			if len(d.steps) != 1 {
				t.Fatalf("steps = %+v", d.steps)
			}
			step := d.steps[0].(*catalog.Step)
			if step.Status != catalog.StatusUnresolved || step.Ref != "" || !strings.Contains(step.Note, "ambiguous-binding") {
				t.Fatalf("ambiguous call guessed: %+v", step)
			}
			warnings := b.Response().Warnings()
			if len(warnings) != 1 || !strings.Contains(warnings[0].Message, "user/first, user/second") {
				t.Fatalf("warnings = %+v", warnings)
			}
		})
	}
}

func TestCompetingProvidersCannotOverwriteBinding(t *testing.T) {
	root := t.TempDir()
	writeQualitySource(t, root, "internal/di/provider.go", `package di
import (
 "example.com/app/internal/application/user/usecases/login"
 "example.com/app/internal/application/user/usecases/first"
 "example.com/app/internal/application/user/usecases/second"
)
func First(a *first.UseCase) login.Authenticator { return a }
func Second(b *second.UseCase) login.Authenticator { return b }
`)
	bindings, ambiguous := readPortBindings(root)
	if len(bindings) != 0 || len(ambiguous["user/login.Authenticator"]) != 2 {
		t.Fatalf("bindings = %v; ambiguous = %v", bindings, ambiguous)
	}
}

func TestAdapterDoesNotChooseFirstCallOrReturn(t *testing.T) {
	p, err := parseSource("adapter.go", `package di
type Adapter struct { first, second Worker }
func (a Adapter) Both() { a.first.Handle(); a.second.Handle() }
func (a Adapter) One() { a.first.Handle(); a.first.Handle() }
func (a Adapter) Deferred() { _ = func() { a.second.Handle() }; a.first.Handle() }
func Provide(flag bool) Port { if flag { return Adapter{} }; return Different{} }
`)
	if err != nil {
		t.Fatal(err)
	}
	calls := handleCalls(p.files[0], "Adapter")
	if calls["Both"] != "" || calls["One"] != "first" || calls["Deferred"] != "first" {
		t.Fatalf("calls = %v", calls)
	}
	for _, decl := range p.files[0].Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Name.Name == "Provide" && returnedType(fn) != "" {
			t.Fatal("picked first returned adapter")
		}
	}
}
