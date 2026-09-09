package extractgo

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/plugin"
)

func writeTestFile(t *testing.T, name, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

const handlerSource = `package user

import (
	"context"

	"github.com/example/auth/internal/application/user/usecases/register"
	"github.com/example/auth/internal/application/user/usecases/change_password"
	"github.com/example/auth/internal/application/session/usecases/validate"
	validatedto "github.com/example/auth/internal/application/session/usecases/validate/dto"
	"github.com/example/auth/internal/infrastructure/transport/http/gen"
)

type Users struct {
	register       *register.UseCase
	changePassword *change_password.UseCase
	validate       *validate.UseCase
}

func (h *Users) RegisterUser(ctx context.Context, request gen.RegisterUserRequestObject) (gen.RegisterUserResponseObject, error) {
	return h.register.Handle(ctx, request.Body)
}

func (h *Users) ChangePassword(ctx context.Context, request gen.ChangePasswordRequestObject) (gen.ChangePasswordResponseObject, error) {
	current, _ := h.validate.Handle(ctx, validatedto.Input{Token: bearer(request)})
	return h.changePassword.Handle(ctx, current)
}

// bearer is a helper, not an endpoint: it takes no request object.
func bearer(request gen.ChangePasswordRequestObject) string { return "" }
`

func exposures(t *testing.T, source string) map[string][]string {
	t.Helper()

	pkg, err := parseSource("handler.go", source)
	if err != nil {
		t.Fatal(err)
	}

	b := &plugin.Builder{}
	out := map[string][]string{}
	for name, fields := range handlerFields(pkg) {
		for _, endpoint := range operationsRunning(pkg, name, fields, isHandler, lowerFirst, b) {
			for _, useCase := range endpoint.useCases {
				out[useCase] = appendOnce(out[useCase], endpoint.id)
			}
		}
	}

	return out
}

// The method name is the document's operationId with a capital letter, and the
// field it reaches is the use case that answers.
func TestHandlerPairsOperationWithUseCase(t *testing.T) {
	got := exposures(t, handlerSource)

	if want := "registerUser"; strings.Join(got["user/register"], ",") != want {
		t.Errorf("user/register = %v, want %s", got["user/register"], want)
	}
}

// One endpoint can run more than one use case: this handler resolves the
// bearer token itself before changing anything.
func TestOneEndpointCanRunSeveralUseCases(t *testing.T) {
	got := exposures(t, handlerSource)

	if want := "changePassword"; strings.Join(got["session/validate"], ",") != want {
		t.Errorf("session/validate = %v, want %s", got["session/validate"], want)
	}
	if want := "changePassword"; strings.Join(got["user/change_password"], ",") != want {
		t.Errorf("user/change_password = %v, want %s", got["user/change_password"], want)
	}
}

// A use case directory name is unique only inside its aggregate, so the
// aggregate travels with it: pairing an endpoint with the wrong `get` would be
// worse than pairing it with nothing.
func TestUseCaseKeysCarryTheirAggregate(t *testing.T) {
	got := exposures(t, handlerSource)

	for key := range got {
		if !strings.Contains(key, "/") {
			t.Errorf("key %q does not name an aggregate", key)
		}
	}
	if _, wrong := got["validate"]; wrong {
		t.Error("a use case was keyed without its aggregate")
	}
}

// Everything in these packages that is not a generated handler is a helper,
// and a helper is not an endpoint.
func TestHelpersAreNotEndpoints(t *testing.T) {
	got := exposures(t, handlerSource)

	for useCase, ids := range got {
		for _, id := range ids {
			if id == "bearer" {
				t.Errorf("%s was paired with a helper", useCase)
			}
		}
	}
}

func TestGrpcMethodRefUsesGeneratedFullMethodName(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "go.mod"), "module github.com/example/pricing\n")
	writeTestFile(t, filepath.Join(root, "gen/shop/v1/price_lists_grpc.pb.go"), `package shopv1

const PriceLists_ArchivePriceList_FullMethodName = "/shop.v1.PriceLists/ArchivePriceList"
`)
	writeTestFile(t, filepath.Join(root, "transport/handler.go"), `package transport

import shopv1 "github.com/example/pricing/gen/shop/v1"

type Handler struct {
	shopv1.UnimplementedPriceListsServer
}
`)

	handlerPkg, err := parsePkg(root, "transport")
	if err != nil {
		t.Fatal(err)
	}
	got := grpcMethodRef(root, handlerPkg, "Handler", "ArchivePriceList")
	if want := "shop.v1.PriceLists/ArchivePriceList"; got != want {
		t.Fatalf("grpc method ref = %q, want %q", got, want)
	}
}

// A handler reaching no use case is doing the work itself, or doing nothing.
// Either is worth saying rather than silently pairing with nothing.
func TestAnEndpointRunningNothingIsReported(t *testing.T) {
	pkg, err := parseSource("handler.go", `package user

import (
	"context"

	"github.com/example/auth/internal/application/user/usecases/register"
	"github.com/example/auth/internal/infrastructure/transport/http/gen"
)

type Users struct {
	register *register.UseCase
}

func (h *Users) Healthz(ctx context.Context, request gen.HealthzRequestObject) (gen.HealthzResponseObject, error) {
	return nil, nil
}
`)
	if err != nil {
		t.Fatal(err)
	}

	b := &plugin.Builder{}
	operationsRunning(pkg, "Users", handlerFields(pkg)["Users"], isHandler, lowerFirst, b)

	if len(b.Warnings) != 1 || !strings.Contains(b.Warnings[0].Message, "runs no use case") {
		t.Errorf("diagnostics = %+v", b.Warnings)
	}
}
