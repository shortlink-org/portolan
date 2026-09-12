package extractopenapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	"gopkg.in/yaml.v3"
)

func fragment(t *testing.T) catalog.Catalog {
	t.Helper()

	resp, err := extract(
		plugin.Input{Root: "testdata"},
		Options{Context: "billing", Service: "invoices", Spec: "openapi.yaml"},
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

// Tags organise operations within one OpenAPI contract. They must not split a
// document into duplicate interfaces with duplicate message inventories.
func TestTagsStayWithinOneService(t *testing.T) {
	provides := provided(t)
	if len(provides) != 1 {
		t.Fatalf("provides = %d, want one contract", len(provides))
	}
	if provides[0].ID != "billing.v2" {
		t.Errorf("interface = %q", provides[0].ID)
	}
	if got := strings.Join(names(provides[0].Methods), ","); got != "raiseInvoice,GET /v2/health" {
		t.Errorf("methods = %q", got)
	}
}

func TestSharedSchemaIsNotRepeatedAcrossTags(t *testing.T) {
	doc := testDocument(t, `
openapi: 3.0.3
info: {title: shared, version: 1.0.0}
paths:
  /orders:
    get:
      tags: [orders]
      operationId: listOrders
      responses:
        '200':
          content:
            application/json:
              schema: {$ref: '#/components/schemas/Result'}
  /refunds:
    get:
      tags: [refunds]
      operationId: listRefunds
      responses:
        '200':
          content:
            application/json:
              schema: {$ref: '#/components/schemas/Result'}
components:
  schemas:
    Result: {type: object}
`)

	services := rpcServices(doc, "shared.v1", "test.yaml", &plugin.Builder{})
	if len(services) != 1 || len(services[0].Methods) != 2 || len(services[0].Messages) != 1 {
		t.Fatalf("contract = %+v", services)
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
		if p.ID != "billing.v2" {
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
	if got := fields["customerId"]; !got.Required || got.Doc != "Who is being billed." {
		t.Errorf("a required field is flagged and carries its description alone, got %+v", got)
	}
	if got := fields["lines"].Type; got != "[]Line" {
		t.Errorf("an array of refs, got %q", got)
	}
	// A field the document does not require carries no flag and no prefix:
	// its description is its own.
	if got := fields["lines"]; got.Required || strings.HasPrefix(got.Doc, "Optional.") {
		t.Errorf("an optional field carries nothing but its description, got %+v", got)
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

	if fields["id"].Type != "string (uuid)" || !fields["id"].Required {
		t.Errorf("allOf required field = %+v", fields["id"])
	}
	if fields["labels"].Type != "map[string]string" || !fields["labels"].Required {
		t.Errorf("map field = %+v", fields["labels"])
	}
	if fields["state"].Type != "string enum(active | disabled)" || fields["state"].Required {
		t.Errorf("enum field = %+v", fields["state"])
	}
	if fields["contact"].Type != "string (email) | string (phone) | null" {
		t.Errorf("oneOf nullable field type = %q", fields["contact"].Type)
	}
}

func TestDiscriminatorKeepsPolymorphicMessagesVisible(t *testing.T) {
	doc := testDocument(t, `
openapi: 3.1.0
info: {title: animals, version: 1.0.0}
paths:
  /pets/{id}:
    get:
      operationId: getPet
      responses:
        '200':
          content:
            application/json:
              schema: {$ref: '#/components/schemas/Pet'}
components:
  schemas:
    Pet:
      oneOf:
        - {$ref: '#/components/schemas/Cat'}
        - {$ref: '#/components/schemas/Dog'}
      discriminator:
        propertyName: kind
        mapping:
          feline: '#/components/schemas/Cat'
    Cat:
      type: object
      required: [kind, lives]
      properties:
        kind: {type: string}
        lives: {type: integer}
    Dog:
      type: object
      required: [kind, good]
      properties:
        kind: {type: string}
        good: {type: boolean}
`)
	services := rpcServices(doc, "animals.v1", "test.yaml", &plugin.Builder{})
	if len(services) != 1 || len(services[0].Methods) != 1 {
		t.Fatalf("services = %+v", services)
	}
	if got := services[0].Methods[0].Response; got != "Pet" {
		t.Fatalf("response = %q, want Pet", got)
	}

	byName := map[string]catalog.RpcMessage{}
	for _, message := range services[0].Messages {
		byName[message.Name] = message
	}
	pet, ok := byName["Pet"]
	if !ok || pet.Discriminator == nil {
		t.Fatalf("Pet discriminator is missing: %+v", pet)
	}
	if pet.Discriminator.Property != "kind" {
		t.Errorf("property = %q", pet.Discriminator.Property)
	}
	if len(pet.Discriminator.Variants) != 2 {
		t.Fatalf("variants = %+v", pet.Discriminator.Variants)
	}
	if got := pet.Discriminator.Variants[0]; got.Value != "feline" || got.Message != "Cat" {
		t.Errorf("mapped variant = %+v", got)
	}
	if got := pet.Discriminator.Variants[1]; got.Value != "Dog" || got.Message != "Dog" {
		t.Errorf("implicit variant = %+v", got)
	}
	if _, ok := byName["Cat"]; !ok {
		t.Error("Cat concrete message is missing")
	}
	if _, ok := byName["Dog"]; !ok {
		t.Error("Dog concrete message is missing")
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

// The same document, read as a copy vendored from outside the estate: the
// fragment carries no context and no service, only the external and what it
// answers on, under the id the manifest gave it.
func TestExternalCarriesNoService(t *testing.T) {
	resp, err := extract(
		plugin.Input{Root: "testdata"},
		Options{External: "psp", ExternalName: "PSP", ExternalURL: "https://psp.example/docs", API: "psp.v1", Spec: "openapi.yaml"},
	)
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Contexts) != 0 {
		t.Errorf("an external's fragment names %d contexts", len(out.Contexts))
	}
	if len(out.Externals) != 1 {
		t.Fatalf("externals = %+v", out.Externals)
	}
	ext := out.Externals[0]
	if ext.ID != "psp" || ext.Slug != "psp" || ext.Name != "PSP" || ext.URL != "https://psp.example/docs" {
		t.Errorf("external = %+v", ext)
	}
	var ids []string
	for _, p := range ext.Provides {
		ids = append(ids, p.ID)
	}
	if strings.Join(ids, ",") != "psp.v1" {
		t.Errorf("interfaces = %v", ids)
	}

	// A dotted id would put the external inside a context nobody declared.
	if _, err := extract(plugin.Input{Root: "testdata"}, Options{External: "shop.psp"}); err == nil {
		t.Error("an external with a dot in its id was accepted")
	}
}

// A Swagger 2.0 document keeps its schemas under definitions, sends its body
// as a parameter and puts the response schema straight on the response. A
// generator that still writes 2.0 - swag, for one - documents a service
// exactly as well as one that writes 3.
func TestSwagger2DefinitionsAndBodyParameters(t *testing.T) {
	resp, err := extract(
		plugin.Input{Root: "testdata/swagger2"},
		Options{Context: "avia", Service: "aviasupp", Spec: "swagger.yaml"},
	)
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}

	byName := map[string]catalog.RpcMethod{}
	shapes := map[string][]string{}
	for _, p := range out.Contexts[0].Services[0].Provides {
		for _, method := range p.Methods {
			byName[method.Name] = method
		}
		for _, message := range p.Messages {
			var fields []string
			for _, field := range message.Fields {
				fields = append(fields, field.Name+" "+field.Type)
			}
			shapes[message.Name] = fields
		}
	}

	book, ok := byName["POST /book"]
	if !ok {
		t.Fatalf("no POST /book among %v", byName)
	}
	if book.Request != "book.Request" || book.Response != "book.Response" {
		t.Errorf("book sends %q and returns %q", book.Request, book.Response)
	}

	// The body parameter is inherited from the path item, and a list of a
	// definition is that definition with brackets.
	search, ok := byName["search"]
	if !ok {
		t.Fatalf("no search among %v", byName)
	}
	if search.Request != "search.Request" || search.Response != "search.Offer[]" {
		t.Errorf("search sends %q and returns %q", search.Request, search.Response)
	}

	if got := strings.Join(shapes["book.Request"], ", "); got != "offer_id string, passengers []book.Passenger" {
		t.Errorf("book.Request = %q", got)
	}
	if _, ok := shapes["book.Passenger"]; !ok {
		t.Errorf("book.Passenger, reached through book.Request, is not among the messages: %v", shapes)
	}
	if _, ok := shapes["search.Offer"]; !ok {
		t.Errorf("search.Offer, the response item, is not among the messages: %v", shapes)
	}
}

// Nothing named: the tree says which documents this service implements and
// which it calls. A server generated from a document means provides; a client
// generated from one means a system outside the estate, named by the
// document's own title, unless the manifest says the api is one of ours. A
// document with neither beside it is reported and left alone.
func TestATreeSaysWhatIsImplementedAndWhatIsCalled(t *testing.T) {
	read := func(opts Options) (catalog.Catalog, plugin.Response) {
		t.Helper()
		opts.Context, opts.Service = "avia", "aviasupp"
		resp, err := extract(plugin.Input{Root: "testdata/discover"}, opts)
		if err != nil {
			t.Fatal(err)
		}
		var out catalog.Catalog
		if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
			t.Fatal(err)
		}
		return out, resp
	}

	out, resp := read(Options{Peers: map[string]string{"partner-api.v2": "shop.partner"}})

	var provided []string
	for _, p := range out.Contexts[0].Services[0].Provides {
		provided = append(provided, p.ID+" from "+p.Source)
	}
	if strings.Join(provided, ", ") != "aviasupp.v1 from testdata/discover/docs/swagger.yaml" {
		t.Errorf("provides = %v", provided)
	}

	if len(out.Externals) != 1 {
		t.Fatalf("externals = %+v", out.Externals)
	}
	acme := out.Externals[0]
	if acme.ID != "acme-flights" || acme.Slug != "acme-flights" || acme.Name != "Acme Flights API" || acme.Summary != "Flights and ancillaries from Acme." || acme.URL != "https://developer.acme.example/flights" {
		t.Errorf("external = %+v", acme)
	}
	if len(acme.Provides) != 1 || acme.Provides[0].ID != "acme-flights-api.v1" {
		t.Errorf("acme provides %+v", acme.Provides)
	}

	warned := func(substring string) bool {
		for _, w := range resp.Warnings() {
			if strings.Contains(w.Message, substring) {
				return true
			}
		}
		return false
	}
	if !warned("found testdata/discover/internal/stray/openapi.yaml, and nothing beside it says") {
		t.Errorf("the stray document was not reported; warnings = %+v", resp.Warnings())
	}
	if !warned("nameless/client/openapi.yaml is called from here and its document has no title") {
		t.Errorf("the nameless document was not reported; warnings = %+v", resp.Warnings())
	}

	// The manifest may name the system itself; and a called document whose
	// api no peers line claims is a system outside the estate too.
	out, _ = read(Options{Externals: map[string]string{"acme-flights-api.v1": "acme"}})
	var ids []string
	for _, e := range out.Externals {
		ids = append(ids, e.ID)
	}
	if strings.Join(ids, ",") != "acme,partner" {
		t.Errorf("externals = %v", ids)
	}
}

// A document that leaves ids off is one limitation of that document, so the
// contract gets one warning naming the count and the routes, not one per route.
func TestMissingOperationIDsAreReportedOncePerContract(t *testing.T) {
	doc := testDocument(t, `
openapi: 3.0.3
info: {title: Fleet, version: 1.0.0}
paths:
  /a: {get: {responses: {"200": {description: ok}}}}
  /b: {get: {responses: {"200": {description: ok}}}, post: {responses: {"200": {description: ok}}}}
  /c: {get: {responses: {"200": {description: ok}}}}
  /d: {get: {responses: {"200": {description: ok}}}}
  /e: {get: {responses: {"200": {description: ok}}}}
  /f: {get: {responses: {"200": {description: ok}}}}
  /named: {get: {operationId: listNamed, responses: {"200": {description: ok}}}}
`)
	b := &plugin.Builder{}
	rpcServices(doc, "fleet.v1", "test.yaml", b)

	if len(b.Warnings) != 1 {
		t.Fatalf("warnings = %+v, want one", b.Warnings)
	}
	w := b.Warnings[0]
	want := "no operationId on 7 of 8 operations; listed by verb and path: GET /a, GET /b, POST /b, GET /c, GET /d and 2 more"
	if w.Ref != "fleet.v1" || w.Message != want {
		t.Errorf("warning = %+v\nwant ref fleet.v1 and %q", w, want)
	}

	b = &plugin.Builder{}
	rpcServices(testDocument(t, `
openapi: 3.0.3
info: {title: Fleet, version: 1.0.0}
paths:
  /named: {get: {operationId: listNamed, responses: {"200": {description: ok}}}}
`), "fleet.v1", "test.yaml", b)
	if len(b.Warnings) != 0 {
		t.Errorf("a fully named document warned: %+v", b.Warnings)
	}
}

// The validation keywords of a property become rules in the catalog's own
// words, the same words a Protovalidate rule arrives in; a `$ref` property
// carries the target's keywords; what an array holds is read under `items.`.
func TestPropertyKeywordsBecomeRules(t *testing.T) {
	doc := testDocument(t, `
components:
  schemas:
    Currency:
      type: string
      minLength: 3
      maxLength: 3
      pattern: '^[A-Z]{3}$'
    Quote:
      type: object
      required: [currency]
      properties:
        currency:
          $ref: '#/components/schemas/Currency'
        total:
          type: integer
          minimum: 0
          exclusiveMinimum: true
          maximum: 9007199254740993
        skus:
          type: array
          minItems: 1
          uniqueItems: true
          items: {type: string, maxLength: 64}
        note:
          type: string
`)
	quote := child(doc.root, "components", "schemas", "Quote")
	fields := map[string]catalog.Field{}
	for _, field := range schemaFields(doc, quote) {
		fields[field.Name] = field
	}

	want := map[string][]catalog.FieldRule{
		"currency": {{Name: "min_len", Value: "3"}, {Name: "max_len", Value: "3"}, {Name: "pattern", Value: "^[A-Z]{3}$"}},
		"total":    {{Name: "gt", Value: "0"}, {Name: "lte", Value: "9007199254740993"}},
		"skus":     {{Name: "min_items", Value: "1"}, {Name: "unique"}, {Name: "items.max_len", Value: "64"}},
		"note":     nil,
	}
	for name, rules := range want {
		if got := fields[name].Rules; !reflect.DeepEqual(got, rules) {
			t.Errorf("%s rules:\n got %+v\nwant %+v", name, got, rules)
		}
	}
	if !fields["currency"].Required || fields["note"].Required {
		t.Errorf("required: currency=%v note=%v", fields["currency"].Required, fields["note"].Required)
	}
}
