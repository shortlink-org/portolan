package openapi

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIDs(t *testing.T) {
	if got := APIID("Auth", "1.2.3"); got != "auth.v1" {
		t.Errorf("APIID = %q", got)
	}
	if got := APIID("", ""); got != "api" {
		t.Errorf("APIID of nothing = %q", got)
	}
	if got := Title("price_list"); got != "PriceList" {
		t.Errorf("Title = %q", got)
	}
	if got := InterfaceID("auth.v1", "sessions"); got != "auth.v1.Sessions" {
		t.Errorf("InterfaceID = %q", got)
	}
	if got := InterfaceID("auth.v1", ""); got != "auth.v1" {
		t.Errorf("InterfaceID without a tag = %q", got)
	}
}

const doc = `openapi: 3.0.3
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
  /v1/health:
    get: {}
`

func TestReadAndFind(t *testing.T) {
	path := filepath.Join(t.TempDir(), "openapi.yaml")
	if err := os.WriteFile(path, []byte(doc), 0o644); err != nil {
		t.Fatal(err)
	}
	spec, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if spec.API != "auth.v1" || len(spec.Operations) != 3 {
		t.Fatalf("spec = %+v", spec)
	}

	login, ok := spec.Find("post", "/v1/sessions")
	if !ok || login.CallID(spec.API) != "auth.v1.Sessions/login" {
		t.Errorf("login = %+v %v", login, ok)
	}
	// A generated client spells the parameter as a format verb.
	user, ok := spec.Find("GET", "/v1/users/%s")
	if !ok || user.CallID(spec.API) != "auth.v1.Users/getUser" {
		t.Errorf("getUser = %+v %v", user, ok)
	}
	health, ok := spec.Find("GET", "/v1/health")
	if !ok || health.CallID(spec.API) != "auth.v1/GET /v1/health" {
		t.Errorf("an operation without an id or tag = %+v %v", health, ok)
	}
	if _, ok := spec.Find("DELETE", "/v1/sessions"); ok {
		t.Error("a verb the document does not declare was found")
	}
}
