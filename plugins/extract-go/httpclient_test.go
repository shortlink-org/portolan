package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// The shape oapi-codegen v2 generates, cut to what the reader looks at: the
// interface, and the request builders with their route.
const generatedHTTPClient = `package gen

import (
	"context"
	"fmt"
	"io"
	"net/http"
)

type ClientInterface interface {
	LoginWithBody(ctx context.Context, contentType string, body io.Reader, reqEditors ...RequestEditorFn) (*http.Response, error)
	Login(ctx context.Context, body LoginJSONRequestBody, reqEditors ...RequestEditorFn) (*http.Response, error)
	GetUser(ctx context.Context, userId string, reqEditors ...RequestEditorFn) (*http.Response, error)
}

type ClientWithResponsesInterface interface {
	LoginWithResponse(ctx context.Context, body LoginJSONRequestBody, reqEditors ...RequestEditorFn) (*LoginResponse, error)
	GetUserWithResponse(ctx context.Context, userId string, reqEditors ...RequestEditorFn) (*GetUserResponse, error)
}

type ClientWithResponses struct{ ClientInterface }

func NewLoginRequest(server string, body LoginJSONRequestBody) (*http.Request, error) {
	return NewLoginRequestWithBody(server, "application/json", nil)
}

func NewLoginRequestWithBody(server string, contentType string, body io.Reader) (*http.Request, error) {
	operationPath := fmt.Sprintf("/v1/sessions")
	req, err := http.NewRequest(http.MethodPost, server+operationPath, body)
	return req, err
}

func NewGetUserRequest(server string, userId string) (*http.Request, error) {
	pathParam0 := userId
	operationPath := fmt.Sprintf("/v1/users/%s", pathParam0)
	req, err := http.NewRequest("GET", server+operationPath, nil)
	return req, err
}

func NewPingRequest(server string) (*http.Request, error) {
	operationPath := fmt.Sprintf("/v1/ping")
	req, err := http.NewRequest(http.MethodGet, server+operationPath, nil)
	return req, err
}
`

const vendoredSpec = `openapi: 3.0.3
info:
  title: auth
  version: 1.0.0
paths:
  /v1/sessions:
    post:
      operationId: login
      tags: [sessions]
  /v1/users/{userId}:
    get:
      operationId: getUser
      tags: [users]
`

func writeTree(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for rel, contents := range files {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, rel)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, rel), []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// The route is read off the request builder and named by the document
// beside it, and every way the client offers the operation is the same call.
func TestAnHTTPClientIsNamedByTheDocumentBesideIt(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{
		"internal/infrastructure/auth/gen/client.gen.go": generatedHTTPClient,
		"internal/infrastructure/auth/gen/openapi.yaml":  vendoredSpec,
	})
	pkg, err := parsePkg(root, "internal/infrastructure/auth/gen")
	if err != nil {
		t.Fatal(err)
	}

	clients, problem := readClients(pkg)
	if !strings.Contains(problem, "GET /v1/ping") {
		t.Errorf("a route the document does not declare should be reported: %q", problem)
	}
	c, ok := clients["ClientWithResponsesInterface"]
	if !ok || c.pkg != "auth.v1" {
		t.Fatalf("clients = %+v", clients)
	}
	for _, name := range httpClientTypes {
		if _, ok := clients[name]; !ok {
			t.Errorf("no client under %s", name)
		}
	}
	want := map[string]string{
		"Login":                       "auth.v1.Sessions/login",
		"LoginWithBody":               "auth.v1.Sessions/login",
		"LoginWithResponse":           "auth.v1.Sessions/login",
		"GetUserWithResponse":         "auth.v1.Users/getUser",
		"GetUser":                     "auth.v1.Users/getUser",
		"GetUserWithBodyWithResponse": "auth.v1.Users/getUser",
	}
	for method, id := range want {
		if c.methods[method] != id {
			t.Errorf("%s = %q, want %q", method, c.methods[method], id)
		}
	}
	if _, named := c.methods["Ping"]; named {
		t.Error("a route the document does not declare was given a name")
	}
	if !strings.HasSuffix(c.source, "openapi.yaml") {
		t.Errorf("source = %q, want the document", c.source)
	}
}

// Without the document the client cannot be named, and the reader says so
// rather than inventing an id from the route.
func TestAnHTTPClientWithoutItsDocumentIsReported(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{
		"internal/infrastructure/auth/gen/client.gen.go": generatedHTTPClient,
	})
	pkg, err := parsePkg(root, "internal/infrastructure/auth/gen")
	if err != nil {
		t.Fatal(err)
	}
	clients, problem := readClients(pkg)
	if len(clients) != 0 || !strings.Contains(problem, "no openapi document beside it") {
		t.Errorf("clients = %v, problem = %q", clients, problem)
	}
}

// The whole chain over HTTP: a use case holds the generated client as a
// port, and a call on it is an rpc to the service the manifest names for the
// api, with the call on the service's consumes.
func TestAUseCaseCallingAnHTTPClientIsAnRpcHop(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{
		"go.mod": "module github.com/example/gateway\n\ngo 1.27\n",
		"internal/infrastructure/auth/gen/client.gen.go": generatedHTTPClient,
		"internal/infrastructure/auth/gen/openapi.yaml":  vendoredSpec,
		"internal/application/session/usecases/whoami/usecase.go": `package whoami

import (
	"context"

	"github.com/example/gateway/internal/infrastructure/auth/gen"
)

type UseCase struct {
	auth gen.ClientWithResponsesInterface
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	resp, err := uc.auth.GetUserWithResponse(ctx, in.UserID)
	if err != nil {
		return dto.Output{}, err
	}
	switch resp.StatusCode() {
	case 200:
		_, err := uc.auth.LoginWithResponse(ctx, gen.LoginJSONRequestBody{})
		return dto.Output{}, err
	case 401, 403:
		return dto.Output{}, ErrRefused
	}
	return dto.Output{}, nil
}
`,
	})

	b := &plugin.Builder{}
	r := newFlowReader(root, flowOptions{context: "edge", svcID: "edge.gateway", service: "gateway", peers: map[string]string{"auth.v1": "auth.auth"}}, b)
	d := newDraft()
	d.lane(r.serviceLane())
	r.walkUseCase(d, "session/whoami", 0)

	if got := dump(d.steps); got != "s1:getUser alt3{s2:login } " {
		t.Fatalf("nodes = %q", got)
	}
	first := d.steps[0].(*catalog.Step)
	if first.Kind != catalog.StepRPC || first.To != "auth.auth" || first.Ref != "auth.v1.Users/getUser" || first.Status != catalog.StatusDeclared {
		t.Errorf("first = %+v", first)
	}
	alt := d.steps[1].(*catalog.Alt)
	titles := []string{}
	for _, br := range alt.Branches {
		titles = append(titles, br.Title)
	}
	if strings.Join(titles, "|") != "resp.StatusCode() is 200|resp.StatusCode() is 401, 403|otherwise" {
		t.Errorf("titles = %q", titles)
	}
	if !alt.Branches[0].Terminal || !alt.Branches[1].Terminal || alt.Branches[2].Terminal {
		t.Errorf("terminal marks = %v %v %v", alt.Branches[0].Terminal, alt.Branches[1].Terminal, alt.Branches[2].Terminal)
	}
	calls := r.consumes()
	if len(calls) != 2 || calls[0].ID != "auth.v1.Sessions/login" || calls[1].ID != "auth.v1.Users/getUser" || calls[0].Peer != "auth.auth" {
		t.Errorf("consumes = %+v", calls)
	}
	for _, diag := range b.Response().Diagnostics {
		if strings.Contains(diag.Message, "/v1/ping") {
			continue
		}
		t.Errorf("unexpected diagnostic: %s", diag.Message)
	}
}
