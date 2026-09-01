package main

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/plugin"
)

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
		for _, e := range operationsRunning(pkg, name, fields, b) {
			out[e.useCase] = appendOnce(out[e.useCase], e.id)
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
	operationsRunning(pkg, "Users", handlerFields(pkg)["Users"], b)

	if len(b.Diagnostics) != 1 || !strings.Contains(b.Diagnostics[0].Message, "runs no use case") {
		t.Errorf("diagnostics = %+v", b.Diagnostics)
	}
}
