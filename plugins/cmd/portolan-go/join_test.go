package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
	extracthttpclients "github.com/shortlink-org/portolan/plugins/extract-http-clients"
)

// Readers of one service join on function keys: a River worker or a Watermill
// handler continues at the flow http-clients extracted from the same function,
// and an RPC call extract-go reads continues at the server extract-go reads in
// another scope. The keys come from four plugins, so they only meet when every
// plugin spells them the same way - from the service's repository - and two
// services of one monorepo context never share one.
//
// The join below is the merge's (src/enrich.ts composeExecutionContinuations):
// an exact key, one flow declaring it, the same owner.
func TestFunctionKeysJoinAcrossPlugins(t *testing.T) {
	cases := []struct {
		name       string
		roots      []string
		repository string
		prefix     string
	}{
		{name: "monorepo service", roots: []string{"examples/shop/oms"}, prefix: "examples/shop/oms/"},
		{name: "two monorepo services of one context", roots: []string{"examples/shop/oms", "examples/shop/pricing"}},
		{name: "fetched copy", roots: []string{"vendor/repos/acme/shop"}, repository: "vendor/repos/acme/shop"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Chdir(t.TempDir())
			var flows []catalog.Flow
			for _, root := range tc.roots {
				writeJoinService(t, root)
				in := plugin.Input{Root: root, Repository: tc.repository}
				service := filepath.Base(root)
				flows = append(flows, extracted(t, "go-domain", in, map[string]any{"context": "shop", "service": service + "-api", "scope": "api", "peers": map[string]string{"book_rpc": "shop." + service + "-book"}})...)
				flows = append(flows, extracted(t, "go-domain", in, map[string]any{"context": "shop", "service": service + "-book", "scope": "book", "store": "redis"})...)
				flows = append(flows, extracted(t, "river", in, map[string]any{"context": "shop", "service": service})...)
				flows = append(flows, extracted(t, "watermill", in, map[string]any{"context": "shop", "service": service})...)
				flows = append(flows, extracted(t, "http-clients", in, map[string]any{"context": "shop", "service": service})...)
			}

			byEntry := map[string]*catalog.Flow{}
			ambiguous := map[string]bool{}
			for i := range flows {
				if key := flows[i].EntryPoint; key != "" {
					if byEntry[key] != nil {
						ambiguous[key] = true
					}
					byEntry[key] = &flows[i]
				}
			}
			joined := map[string]string{}
			for _, flow := range flows {
				walkJoinSteps(flow.Steps, func(step *catalog.Step) {
					for _, key := range append([]string{step.ContinuesAt}, step.Reaches...) {
						target := byEntry[key]
						if key == "" || target == nil || ambiguous[key] || target.Owner != flow.Owner {
							continue
						}
						joined[flow.Slug+" -> "+key] = target.Slug
					}
				})
			}

			for _, root := range tc.roots {
				prefix := tc.prefix
				if len(tc.roots) > 1 {
					prefix = root + "/"
				}
				service := filepath.Base(root)
				for _, want := range []struct{ from, key, to string }{
					{service + "-river-send-mail-mail", prefix + "internal/jobs:SendWorker.Work", "shop." + service + "-http-client-internal-jobs-sendworker-work"},
					{service + "-watermill-orders-placed-consume", prefix + "internal/events:Handler.OnPlaced", "shop." + service + "-http-client-internal-events-handler-onplaced"},
					{service + "-api-http-post-book-rent-bookid", prefix + "internal/book/infrastructure/rpc:BookServer.Rent", service + "-book-grpc-book-rpc-bookrpc-rent"},
				} {
					if got := joined[want.from+" -> "+want.key]; got != want.to {
						t.Errorf("%s continues at %s in %q, want %q\nflows = %v", want.from, want.key, got, want.to, slugsAndKeys(flows))
					}
				}
			}
			if len(joined) != 3*len(tc.roots) {
				t.Errorf("joins = %v", joined)
			}
			// Spelled from each input root, as the keys were before, the two
			// services declare one entrypoint twice and the merge composes
			// neither.
			if len(tc.roots) > 1 {
				rootSpelled := map[string]int{}
				for _, flow := range flows {
					for _, root := range tc.roots {
						if rest, ok := strings.CutPrefix(flow.EntryPoint, root+"/"); ok {
							rootSpelled[rest]++
						}
					}
				}
				if rootSpelled["internal/jobs:SendWorker.Work"] != len(tc.roots) {
					t.Errorf("root-spelled entrypoints = %v", rootSpelled)
				}
			}
		})
	}
}

func extracted(t *testing.T, name string, in plugin.Input, options map[string]any) []catalog.Flow {
	t.Helper()
	encoded, err := json.Marshal(options)
	if err != nil {
		t.Fatal(err)
	}
	request, err := json.Marshal(plugin.Request{PortolanVersion: plugin.Version, Input: in, Options: encoded})
	if err != nil {
		t.Fatal(err)
	}
	var stdout bytes.Buffer
	serve := Plugins[name]
	if name == "http-clients" {
		// Its own binary (plugins/cmd/portolan-http-clients), not a wasm name.
		serve = extracthttpclients.Serve
	}
	if err := serve(bytes.NewReader(request), &stdout); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	var response plugin.Response
	if err := json.Unmarshal(stdout.Bytes(), &response); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	var out []catalog.Flow
	for _, file := range response.Files {
		var fragment catalog.Catalog
		if err := json.Unmarshal([]byte(file.Contents), &fragment); err != nil {
			continue
		}
		out = append(out, fragment.Flows...)
	}
	return out
}

func walkJoinSteps(nodes catalog.FlowNodes, visit func(*catalog.Step)) {
	for _, node := range nodes {
		switch node := node.(type) {
		case *catalog.Step:
			visit(node)
		case *catalog.Alt:
			for _, branch := range node.Branches {
				walkJoinSteps(branch.Steps, visit)
			}
		case *catalog.Parallel:
			for _, branch := range node.Branches {
				walkJoinSteps(branch, visit)
			}
		case *catalog.Loop:
			walkJoinSteps(node.Steps, visit)
		}
	}
}

func slugsAndKeys(flows []catalog.Flow) map[string][]string {
	out := map[string][]string{}
	for _, flow := range flows {
		keys := []string{"entry=" + flow.EntryPoint}
		walkJoinSteps(flow.Steps, func(step *catalog.Step) {
			if step.ContinuesAt != "" {
				keys = append(keys, "continues="+step.ContinuesAt)
			}
			for _, key := range step.Reaches {
				keys = append(keys, "reaches="+key)
			}
		})
		out[flow.Slug] = keys
	}
	return out
}

func writeJoinService(t *testing.T, root string) {
	t.Helper()
	files := map[string]string{
		"go.mod": "module example.com/shop\n\ngo 1.24\n",
		"internal/jobs/send.go": `package jobs
import (
  "context"
  "net/http"
  "github.com/riverqueue/river"
)
type SendArgs struct { MessageID string }
func (SendArgs) Kind() string { return "send_mail" }
type SendWorker struct { river.WorkerDefaults[SendArgs] }
func (*SendWorker) Work(ctx context.Context, job *river.Job[SendArgs]) error {
  _, err := http.Post("https://mail.example.com/v1/messages", "application/json", nil)
  return err
}
func Setup(workers *river.Workers, client interface { Insert(context.Context, river.JobArgs, *river.InsertOpts) (any, error) }, ctx context.Context) {
  river.AddWorker(workers, &SendWorker{})
  _, _ = client.Insert(ctx, SendArgs{MessageID: "1"}, &river.InsertOpts{Queue: "mail"})
}
`,
		"internal/events/handler.go": `package events
import (
  "net/http"
  "github.com/ThreeDotsLabs/watermill/message"
)
type Handler struct{}
func (h *Handler) OnPlaced(msg *message.Message) error {
  _, err := http.Get("https://crm.example.com/v1/notify")
  return err
}
func Register(r *message.Router, sub message.Subscriber, h *Handler) {
  r.AddNoPublisherHandler("orders_placed", "orders.placed", sub, h.OnPlaced)
}
`,
		"internal/api/http/api.go": `package http
import book_rpc "example.com/shop/internal/book/infrastructure/rpc"
type API struct { BookService book_rpc.BookRPCClient }
func (api *API) Run() { r.Mount("/book", api.BookRoutes()) }
func (api *API) BookRoutes() Router { r.Post("/rent/{bookId}", api.RentBook); return r }
func (api *API) RentBook(w Writer, req *Request) {
  _, err := api.BookService.Rent(req.Context(), &book_rpc.RentRequest{})
  if err != nil { return }
}
`,
		"internal/book/infrastructure/rpc/book_grpc.pb.go": `package book_rpc
type BookRPCClient interface { Rent(context.Context, *RentRequest, ...grpc.CallOption) (*RentResponse, error) }
type bookRPCClient struct { cc grpc.ClientConnInterface }
func (c *bookRPCClient) Rent(ctx context.Context, in *RentRequest, opts ...grpc.CallOption) (*RentResponse, error) {
	out := new(RentResponse); if err := c.cc.Invoke(ctx, "/book_rpc.BookRPC/Rent", in, out, opts...); err != nil { return nil, err }; return out, nil
}
type UnimplementedBookRPCServer struct{}
`,
		"internal/book/infrastructure/rpc/server.go": `package book_rpc
import book "example.com/shop/internal/book/application"
type BookServer struct { UnimplementedBookRPCServer; service *book.Service }
func (s *BookServer) Rent(ctx context.Context, in *RentRequest) (*RentResponse, error) { _, err := s.service.Rent(ctx, in.Id); return nil, err }
`,
		"internal/book/application/service.go": `package book
type Service struct { Store Repository }
func (s *Service) Rent(ctx context.Context, id string) (any, error) { return s.Store.Update(ctx, id) }
type Repository interface { Update(context.Context, string) (any, error) }
`,
	}
	for name, contents := range files {
		filename := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
