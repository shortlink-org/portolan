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
	if store := flow.Steps[2].(*catalog.Step); store.To != "book-redis" || store.Label != "Update" {
		t.Fatalf("store = %+v", store)
	}
}
