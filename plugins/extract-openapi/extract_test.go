package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"gopkg.in/yaml.v3"
)

func fragment(t *testing.T) catalog.Catalog {
	t.Helper()

	resp, err := extract(
		plugin.Input{Root: "testdata", Commit: "abc1234", GeneratedAt: "2026-01-01T00:00:00Z"},
		Options{Context: "billing", Service: "invoices"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Files) != 1 {
		t.Fatalf("expected one fragment, got %d files", len(resp.Files))
	}

	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}

	return out
}

func testDocument(t *testing.T, source string) *document {
	t.Helper()
	var root yaml.Node
	if err := yaml.Unmarshal([]byte(source), &root); err != nil {
		t.Fatal(err)
	}
	node := root.Content[0]
	return &document{root: node, path: "test.yaml", cache: map[string]*document{}}
}

func provided(t *testing.T) []catalog.RpcService {
	t.Helper()

	return fragment(t).Contexts[0].Services[0].Provides
}

// A method is an object now, and every assertion below is about the names.
func names(methods []catalog.RpcMethod) []string {
	out := make([]string, 0, len(methods))
	for _, method := range methods {
		out = append(out, method.Name)
	}

	return out
}

// A tag says "these endpoints belong together", which is what a proto service
// says too - so tags become rpc services and operation ids become methods.
func TestTagsBecomeServices(t *testing.T) {
	provides := provided(t)

	got := map[string][]string{}
	for _, p := range provides {
		got[p.ID] = names(p.Methods)
	}

	if methods := got["billing.v2.Invoices"]; strings.Join(methods, ",") != "raiseInvoice" {
		t.Errorf("tagged operations: %v", methods)
	}

	// An untagged operation still has to be findable, under the api itself.
	if methods := got["billing.v2"]; strings.Join(methods, ",") != "GET /v2/health" {
		t.Errorf("untagged operation: %v", methods)
	}
}

// The id is the document's own title and major version, so it survives a patch
// release without every id in the catalog changing.
func TestApiIDFromTitleAndMajorVersion(t *testing.T) {
	for _, p := range provided(t) {
		if !strings.HasPrefix(p.ID, "billing.v2") {
			t.Errorf("unexpected id %q", p.ID)
		}
	}
}

// A shared response is how a spec says "the same error body as everywhere
// else". Not following it would document the endpoint as returning nothing
// when it fails.
func TestFollowsRefsThroughSharedResponses(t *testing.T) {
	var names []string
	for _, p := range provided(t) {
		if p.ID != "billing.v2.Invoices" {
			continue
		}
		for _, message := range p.Messages {
			names = append(names, message.Name)
		}
	}

	// Line arrives through RaiseRequest, Error through the shared BadRequest.
	want := "RaiseRequest,Invoice,Error,Line"
	if strings.Join(names, ",") != want {
		t.Errorf("messages = %v, want %s", names, want)
	}
}

func TestFieldTypesAndOptionality(t *testing.T) {
	var request *catalog.RpcMessage
	for _, p := range provided(t) {
		for i := range p.Messages {
			if p.Messages[i].Name == "RaiseRequest" {
				request = &p.Messages[i]
			}
		}
	}
	if request == nil {
		t.Fatal("no RaiseRequest message")
	}

	fields := map[string]catalog.Field{}
	for _, field := range request.Fields {
		fields[field.Name] = field
	}

	if got := fields["customerId"].Type; got != "string (uuid)" {
		t.Errorf("format belongs in the type, got %q", got)
	}
	if got := fields["customerId"].Doc; got != "Who is being billed." {
		t.Errorf("a required field carries its description alone, got %q", got)
	}
	if got := fields["lines"].Type; got != "[]Line" {
		t.Errorf("an array of refs, got %q", got)
	}
	// Which fields must be sent is the first thing a caller needs, and the
	// catalog has nowhere else to put it.
	if got := fields["lines"].Doc; !strings.HasPrefix(got, "Optional.") {
		t.Errorf("an optional field should say so, got %q", got)
	}
}

func TestComposedSchemasMapsEnumsAndNullableTypes(t *testing.T) {
	doc := testDocument(t, `
components:
  schemas:
    Base:
      type: object
      required: [id]
      properties:
        id: {type: string, format: uuid}
    Account:
      allOf:
        - $ref: '#/components/schemas/Base'
        - type: object
          required: [labels]
          properties:
            labels:
              type: object
              additionalProperties: {type: string}
            state:
              type: string
              enum: [active, disabled]
            contact:
              nullable: true
              oneOf:
                - {type: string, format: email}
                - {type: string, format: phone}
`)
	account := child(doc.root, "components", "schemas", "Account")
	fields := map[string]catalog.Field{}
	for _, field := range schemaFields(doc, account) {
		fields[field.Name] = field
	}

	if fields["id"].Type != "string (uuid)" || strings.HasPrefix(fields["id"].Doc, "Optional.") {
		t.Errorf("allOf required field = %+v", fields["id"])
	}
	if fields["labels"].Type != "map[string]string" || strings.HasPrefix(fields["labels"].Doc, "Optional.") {
		t.Errorf("map field = %+v", fields["labels"])
	}
	if fields["state"].Type != "string enum(active | disabled)" || !strings.HasPrefix(fields["state"].Doc, "Optional.") {
		t.Errorf("enum field = %+v", fields["state"])
	}
	if fields["contact"].Type != "string (email) | string (phone) | null" {
		t.Errorf("oneOf nullable field type = %q", fields["contact"].Type)
	}
}

func TestRelativeExternalSchemaRefsAreLoaded(t *testing.T) {
	dir := t.TempDir()
	common := filepath.Join(dir, "common.yaml")
	root := filepath.Join(dir, "openapi.yaml")
	if err := os.WriteFile(common, []byte(`components:
  schemas:
    External:
      type: object
      required: [code]
      properties:
        code: {type: integer, format: int64}
`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root, []byte(`openapi: 3.1.0
info: {title: external, version: 1.0.0}
paths:
  /external:
    get:
      operationId: getExternal
      responses:
        '200':
          content:
            application/json:
              schema: {$ref: './common.yaml#/components/schemas/External'}
`), 0o600); err != nil {
		t.Fatal(err)
	}
	doc, err := load(root)
	if err != nil {
		t.Fatal(err)
	}
	services := rpcServices(doc, "external.v1", root, &plugin.Builder{})
	if len(services) != 1 || len(services[0].Messages) != 1 {
		t.Fatalf("services = %+v", services)
	}
	message := services[0].Messages[0]
	if message.Name != "External" || len(message.Fields) != 1 || message.Fields[0].Type != "integer (int64)" {
		t.Errorf("external message = %+v", message)
	}
}

// The fragment describes what the service answers and nothing else; the name
// and readme belong to whichever source knows them.
func TestFragmentClaimsNothingItDoesNotKnow(t *testing.T) {
	service := fragment(t).Contexts[0].Services[0]

	if service.Name != "" || service.Readme != "" || service.Repo != "" {
		t.Errorf("the api fragment should not name the service: %+v", service)
	}
	if len(service.Aggregates) != 0 {
		t.Error("the api fragment should carry no aggregates")
	}
}

// What the operation sends and answers with. The document names both whenever
// the body is a $ref; a success with no body at all is answered by its status,
// because 204 is a real answer and an empty string reads as an unread one.
func TestShapesOnEitherSide(t *testing.T) {
	byName := map[string]catalog.RpcMethod{}
	for _, p := range provided(t) {
		for _, method := range p.Methods {
			byName[method.Name] = method
		}
	}

	raise, ok := byName["raiseInvoice"]
	if !ok {
		t.Fatal("no raiseInvoice")
	}
	if raise.Request != "RaiseRequest" || raise.Response != "Invoice" {
		t.Errorf("raiseInvoice sends %q and returns %q", raise.Request, raise.Response)
	}

	health, ok := byName["GET /v2/health"]
	if !ok {
		t.Fatal("no health operation")
	}
	if health.Request != "" || health.Response != "200" {
		t.Errorf("health sends %q and returns %q", health.Request, health.Response)
	}
}
