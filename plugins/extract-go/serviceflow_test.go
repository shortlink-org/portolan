package extractgo

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestHTTPMarshalPackageEncoding(t *testing.T) {
	cases := map[string]string{
		"encoding/json": "json",
		"google.golang.org/protobuf/encoding/protojson": "protojson",
		"github.com/vmihailenco/msgpack/v5":             "msgpack",
		"example.com/project/codec":                     "",
	}
	for importPath, want := range cases {
		if got := httpMarshalPackageEncoding(importPath); got != want {
			t.Errorf("%s = %q, want %q", importPath, got, want)
		}
	}
}

func TestServiceStyleHTTPAndGRPCFlowsComposeByEntrypoint(t *testing.T) {
	root := t.TempDir()
	write := func(name, contents string) {
		t.Helper()
		filename := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("go.mod", "module example.com/platform\n")
	write("internal/api/http/api.go", `package http
import (
  book_rpc "example.com/platform/internal/book/infrastructure/rpc"
  "google.golang.org/protobuf/encoding/protojson"
)
type API struct { BookService book_rpc.BookRPCClient }
func (api *API) Run() { r.Mount("/book", api.BookRoutes()) }
func (api *API) BookRoutes() Router { r.Post("/rent/{bookId}", api.RentBook); return r }
func (api *API) RentBook(w Writer, req *Request) {
  w.Header().Add("Content-type", "application/json")
  resp, err := api.BookService.Rent(req.Context(), &book_rpc.RentRequest{})
  if err != nil { _, _ = w.Write([]byte(`+"`"+`{"error":"boom"}`+"`"+`)); return }
  m := protojson.MarshalOptions{}
  payload, err := m.Marshal(resp)
  if err != nil { _, _ = w.Write([]byte(`+"`"+`{"error":"encode"}`+"`"+`)) }
  _, _ = w.Write(payload)
}
`)
	write("internal/book/infrastructure/rpc/book_grpc.pb.go", `package book_rpc
type BookRPCClient interface { Rent(context.Context, *RentRequest, ...grpc.CallOption) (*RentResponse, error) }
type bookRPCClient struct { cc grpc.ClientConnInterface }
func (c *bookRPCClient) Rent(ctx context.Context, in *RentRequest, opts ...grpc.CallOption) (*RentResponse, error) {
	out := new(RentResponse); if err := c.cc.Invoke(ctx, "/book_rpc.BookRPC/Rent", in, out, opts...); err != nil { return nil, err }; return out, nil
}
type UnimplementedBookRPCServer struct{}
`)
	write("internal/book/infrastructure/rpc/server.go", `package book_rpc
import book "example.com/platform/internal/book/application"
type BookServer struct { UnimplementedBookRPCServer; service *book.Service }
func (s *BookServer) Rent(ctx context.Context, in *RentRequest) (*RentResponse, error) { _, err := s.service.Rent(ctx, in.Id); return nil, err }
`)
	write("internal/book/application/service.go", `package book
import user_rpc "example.com/platform/internal/user/infrastructure/rpc"
type Service struct { User user_rpc.UserRPCClient; Store *BookStore }
func (s *Service) Rent(ctx context.Context, id string) (any, error) { if _, err := s.User.Get(ctx, &user_rpc.GetRequest{}); err != nil { return nil, err }; return s.Store.Store.Update(ctx, id) }
type BookStore struct { Store Repository }
type Repository interface { Update(context.Context, string) (any, error) }
`)
	write("internal/user/infrastructure/rpc/user_grpc.pb.go", `package user_rpc
type UserRPCClient interface { Get(context.Context, *GetRequest, ...grpc.CallOption) (*GetResponse, error) }
type userRPCClient struct { cc grpc.ClientConnInterface }
func (c *userRPCClient) Get(ctx context.Context, in *GetRequest, opts ...grpc.CallOption) (*GetResponse, error) { out := new(GetResponse); if err := c.cc.Invoke(ctx, "/user_rpc.UserRPC/Get", in, out, opts...); err != nil { return nil, err }; return out, nil }
`)

	api, err := extract(plugin.Input{Root: root}, Options{Context: "platform", Service: "api", Scope: "api", Peers: map[string]string{"book_rpc": "platform.book", "user_rpc": "platform.user"}})
	if err != nil {
		t.Fatal(err)
	}
	var apiCatalog catalog.Catalog
	if err := json.Unmarshal([]byte(api.Files[0].Contents), &apiCatalog); err != nil {
		t.Fatal(err)
	}
	if len(apiCatalog.Flows) != 1 {
		t.Fatalf("api flows = %+v", apiCatalog.Flows)
	}
	apiSteps := apiCatalog.Flows[0].Steps
	call := apiSteps[1].(*catalog.Step)
	if call.Ref != "book_rpc.BookRPC/Rent" || call.To != "platform.book" || call.ContinuesAt != "internal/book/infrastructure/rpc:BookServer.Rent" {
		t.Fatalf("api rpc = %+v", call)
	}
	if len(apiSteps) != 5 {
		t.Fatalf("api steps = %+v", apiSteps)
	}
	failure := apiSteps[2].(*catalog.Alt).Branches[0].Steps[0].(*catalog.Step)
	if failure.Kind != catalog.StepResponse || failure.ReplyTo != "s1" || failure.HTTP == nil || failure.HTTP.Outcome != "error" || failure.HTTP.Status != 200 || failure.HTTP.Fields[0].Name != "error" || failure.HTTP.Warning == "" {
		t.Fatalf("error response = %+v", failure)
	}
	encodeFailure := apiSteps[3].(*catalog.Alt).Branches[0].Steps[0].(*catalog.Step)
	if encodeFailure.HTTP == nil || !strings.Contains(encodeFailure.HTTP.Warning, "may append another response") {
		t.Fatalf("continuing error response = %+v", encodeFailure)
	}
	success := apiSteps[4].(*catalog.Step)
	if success.Kind != catalog.StepResponse || success.HTTP == nil || success.HTTP.BodyRef != "book_rpc.BookRPC/Rent" || success.HTTP.Encoding != "protojson" || success.HTTP.ContentType != "application/json" {
		t.Fatalf("success response = %+v", success)
	}

	book, err := extract(plugin.Input{Root: root}, Options{Context: "platform", Service: "book", Scope: "book", Store: "redis", Peers: map[string]string{"user_rpc": "platform.user"}})
	if err != nil {
		t.Fatal(err)
	}
	var bookCatalog catalog.Catalog
	if err := json.Unmarshal([]byte(book.Files[0].Contents), &bookCatalog); err != nil {
		t.Fatal(err)
	}
	if len(bookCatalog.Flows) != 1 {
		t.Fatalf("book flows = %+v", bookCatalog.Flows)
	}
	flow := bookCatalog.Flows[0]
	if flow.EntryPoint != "internal/book/infrastructure/rpc:BookServer.Rent" {
		t.Fatalf("entrypoint = %q", flow.EntryPoint)
	}
	if len(flow.Steps) != 3 {
		t.Fatalf("book steps = %+v", flow.Steps)
	}
	if rpc := flow.Steps[1].(*catalog.Step); rpc.Ref != "user_rpc.UserRPC/Get" || rpc.To != "platform.user" {
		t.Fatalf("user rpc = %+v", rpc)
	}
	if store := flow.Steps[2].(*catalog.Step); store.To != "book-redis" || store.Label != "Update" || store.StoreAccess == nil || store.StoreAccess.Store != "platform.book.redis" || store.StoreAccess.Method != "Update" {
		t.Fatalf("store = %+v", store)
	}
}

func TestRegisteredPlainGoServicesDoNotRequireDDDOrScope(t *testing.T) {
	for _, dir := range []string{"", "web", "internal/handlers"} {
		for _, registration := range []string{
			`func Register(h *Handler) { http.HandleFunc("POST /orders", h.Create) }`,
			`func Register(h *Handler) { mux := http.NewServeMux(); mux.HandleFunc("POST /orders", h.Create) }`,
			`func Register(mux *http.ServeMux, h *Handler) { mux.Handle("POST /orders", http.HandlerFunc(h.Create)) }`,
			`func Register() { http.HandleFunc("POST /orders", Create) }; func Create(w http.ResponseWriter, req *http.Request) { service := &Service{}; service.Execute() }`,
		} {
			t.Run(dir+registration, func(t *testing.T) {
				root := t.TempDir()
				writeQualitySource(t, root, "go.mod", "module example.com/plain\n\ngo 1.24\n")
				writeQualitySource(t, root, filepath.Join(dir, "routes.go"), `package web
import "net/http"
type Repository interface { Save() }
type Service struct { repo Repository }
func (s *Service) Execute() { s.repo.Save() }
type Handler struct { service *Service }
func (h *Handler) Create(w http.ResponseWriter, req *http.Request) { h.service.Execute() }
`+registration)
				response, err := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "orders", Store: "pg"})
				if err != nil {
					t.Fatal(err)
				}
				var fragment catalog.Catalog
				if err := json.Unmarshal([]byte(response.Files[0].Contents), &fragment); err != nil {
					t.Fatal(err)
				}
				if len(fragment.Flows) != 1 {
					t.Fatalf("flows = %+v; warnings = %+v", fragment.Flows, response.Warnings())
				}
				flow := fragment.Flows[0]
				if flow.Name != "POST /orders" || flow.Trigger == nil || flow.Trigger.Kind != "http" {
					t.Fatalf("wrong root: %+v", flow)
				}
				if len(flow.Steps) != 3 {
					t.Fatalf("steps = %+v", flow.Steps)
				}
				save := flow.Steps[2].(*catalog.Step)
				if save.Label != "Save" || save.StoreAccess == nil || save.StoreAccess.Store != "shop.orders.pg" {
					t.Fatalf("lost Service.Execute -> Repository.Save: %+v", save)
				}
				if len(fragment.Contexts[0].Services[0].Aggregates) != 0 {
					t.Fatal("invented aggregate")
				}
				if len(response.Warnings()) != 0 {
					t.Fatalf("unexpected warnings: %+v", response.Warnings())
				}
			})
		}
	}
}

func TestPlainServiceDiscoveryExcludesUnregisteredAndForeignPackages(t *testing.T) {
	root := t.TempDir()
	writeQualitySource(t, root, "go.mod", "module example.com/plain\n")
	source := `package handlers
import "net/http"
type Handler struct{}
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {}
func Register(h *Handler) { http.HandleFunc("POST /orders",h.Create) }
`
	writeQualitySource(t, root, "web/routes.go", source)
	writeQualitySource(t, root, "nested/go.mod", "module example.com/foreign\n")
	for _, dir := range []string{"nested", "vendor/x", "testdata/x", "node_modules/x"} {
		writeQualitySource(t, root, dir+"/routes.go", source)
	}
	writeQualitySource(t, root, "web/unregistered.go", `package handlers
func (h *Handler) Unregistered(w http.ResponseWriter, r *http.Request) {}
`)
	endpoints := serviceEndpoints(root, "")
	if len(endpoints) != 1 || endpoints[0].label != "POST /orders" {
		t.Fatalf("endpoints = %+v", endpoints)
	}
	if scoped := serviceEndpoints(root, "another"); len(scoped) != 0 {
		t.Fatalf("scope leaked: %+v", scoped)
	}
}

func TestRouterLikeBusinessMethodsAreNotRegistrations(t *testing.T) {
	root := t.TempDir()
	writeQualitySource(t, root, "web/service.go", `package web
import "net/http"
type Store struct{}
func (s *Store) Get(key string, cb func()) {}
type Handler struct { store *Store }
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {}
func (h *Handler) Run() { h.store.Get("/orders",h.Create) }
`)
	if endpoints := serviceEndpoints(root, ""); len(endpoints) != 0 {
		t.Fatalf("business method became a route: %+v", endpoints)
	}
}
