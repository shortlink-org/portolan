package extractgo

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// routeFixture is one module with a chi service, a gin gateway and a package
// of handlers and constants the routes borrow from.
func routeFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeQualitySource(t, root, "go.mod", "module example.com/shop\n\ngo 1.24\n")
	writeQualitySource(t, root, "internal/paths/paths.go", `package paths
const Items = "/items"
const API = "/api"
`)
	writeQualitySource(t, root, "internal/users/users.go", `package users
import "net/http"
type Repository interface { Save() }
type Handler struct { repo Repository }
func NewHandler() *Handler { return &Handler{} }
func (h *Handler) Show(w http.ResponseWriter, r *http.Request) { h.repo.Save() }
func List(w http.ResponseWriter, r *http.Request) {}
`)
	writeQualitySource(t, root, "internal/api/routes.go", `package api
import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"example.com/shop/internal/paths"
	"example.com/shop/internal/users"
)

const base = "/v1"
const ordersPath = "/orders"

type Repository interface { Save() }
type Service struct { repo Repository }
func (s *Service) Execute() { s.repo.Save() }
type Handler struct { service *Service }

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {}
func (h *Handler) List(w http.ResponseWriter, r *http.Request) { h.service.Execute() }
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {}
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {}
func (h *Handler) Flush(w http.ResponseWriter, r *http.Request) {}
func (h *Handler) Save(w http.ResponseWriter, r *http.Request) {}
func (h *Handler) X(w http.ResponseWriter, r *http.Request) {}
func (h *Handler) Report() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { h.service.Execute() }
}
func (h *Handler) Sub() http.Handler {
	r := chi.NewRouter()
	r.Get("/x", h.X)
	return r
}

func (h *Handler) Routes(r chi.Router, n int, handlers []http.HandlerFunc) {
	r.Get("/health", h.Health)
	r.Get(ordersPath, h.List)
	r.Get(paths.Items, h.List)
	r.Post(base+"/items", h.Create)
	r.Get("/ping", func(w http.ResponseWriter, req *http.Request) { h.service.Execute() })
	r.Get("/report", h.Report())
	r.Get("/users", users.List)
	uh := users.NewHandler()
	r.Get("/users/{id}", uh.Show)
	r.Route("/admin", func(r chi.Router) {
		r.Get("/stats", h.Stats)
		r.With(auth).Delete("/cache", h.Flush)
	})
	r.Group(func(r chi.Router) {
		r.Use(auth)
		r.Put("/settings", h.Save)
	})
	r.Mount(paths.API, h.Sub())
	r.Get(fmt.Sprintf("/dyn/%d", n), h.X)
	r.Get("/indexed", handlers[n])
	r.Handle("/metrics", promhttp.Handler())
}

func auth(next http.Handler) http.Handler { return next }
`)
	writeQualitySource(t, root, "internal/gw/gw.go", `package gw
import (
	"github.com/gin-gonic/gin"
)
type Handler struct{}
func (h *Handler) List(c *gin.Context) {}
func (h *Handler) Show(c *gin.Context) {}
func (h *Handler) Reindex(c *gin.Context) {}

func Router(h *Handler) *gin.Engine {
	e := gin.New()
	v1 := e.Group("/v1")
	{
		items := v1.Group("/items")
		items.GET("", h.List)
		items.GET("/:id", h.Show)
	}
	registerAdmin(v1.Group("/admin"), h)
	return e
}

func registerAdmin(g *gin.RouterGroup, h *Handler) {
	g.POST("/reindex", h.Reindex)
}
`)
	return root
}

func TestRouteShapesResolveToEndpoints(t *testing.T) {
	root := routeFixture(t)
	endpoints, skipped := serviceEndpointsAndSkips(root, "")
	got := map[string]string{}
	for _, endpoint := range endpoints {
		if endpoint.kind == "http" {
			got[endpoint.label] = endpoint.entrypoint
		}
	}
	want := map[string]string{
		// literal, package constant, imported constant, concatenation
		"GET /health":    "internal/api:Handler.Health",
		"GET /orders":    "internal/api:Handler.List",
		"GET /items":     "internal/api:Handler.List",
		"POST /v1/items": "internal/api:Handler.Create",
		// closure in place, factory, handlers of another package
		"GET /ping":       "internal/api:Handler.Routes.func1",
		"GET /report":     "internal/api:Handler.Report.func1",
		"GET /users":      "internal/users:List",
		"GET /users/{id}": "internal/users:Handler.Show",
		// chi Route, With, Group, Mount under an imported constant
		"GET /admin/stats":    "internal/api:Handler.Stats",
		"DELETE /admin/cache": "internal/api:Handler.Flush",
		"PUT /settings":       "internal/api:Handler.Save",
		"GET /api/x":          "internal/api:Handler.X",
		// gin nested groups and a group handed to a function
		"GET /v1/items":          "internal/gw:Handler.List",
		"GET /v1/items/:id":      "internal/gw:Handler.Show",
		"POST /v1/admin/reindex": "internal/gw:Handler.Reindex",
	}
	for label, entry := range want {
		if got[label] != entry {
			t.Errorf("%s -> %q, want %q", label, got[label], entry)
		}
	}
	for label := range got {
		if _, ok := want[label]; !ok {
			t.Errorf("unexpected endpoint %s -> %s", label, got[label])
		}
	}

	var reasons []string
	for _, skip := range skipped {
		if !strings.HasPrefix(skip.ref, root+"/internal/api/routes.go:") {
			t.Errorf("skip ref = %q", skip.ref)
		}
		reasons = append(reasons, skip.message())
	}
	sort.Strings(reasons)
	if len(reasons) != 3 {
		t.Fatalf("skipped = %q", reasons)
	}
	for i, fragment := range []string{
		`GET "/indexed" has a handler, handlers[n], that is not a function`,
		`GET fmt.Sprintf("/dyn/%d", n) has a path that is not a literal`,
		`Handle "/metrics" has a handler, promhttp.Handler(), that is built by a function that is not declared in this module`,
	} {
		if !strings.HasPrefix(reasons[i], "http.route-skipped: ") || !strings.Contains(reasons[i], fragment) {
			t.Errorf("skip %d = %q, want it to say %q", i, reasons[i], fragment)
		}
	}
}

// A closure and a factory's closure are followed like a method: the flow
// reaches the repository the enclosing receiver holds, and a route that is
// skipped says so once.
func TestClosureRoutesBecomeFlowsAndSkipsWarn(t *testing.T) {
	root := routeFixture(t)
	response, err := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "api", Scope: "api", Store: "pg"})
	if err != nil {
		t.Fatal(err)
	}
	var fragment catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &fragment); err != nil {
		t.Fatal(err)
	}
	flows := map[string]catalog.Flow{}
	for _, flow := range fragment.Flows {
		flows[flow.Name] = flow
	}
	for _, name := range []string{"GET /ping", "GET /report", "GET /orders"} {
		flow, ok := flows[name]
		if !ok {
			t.Errorf("no flow for %s; flows = %v", name, fragment.Flows)
			continue
		}
		last := flow.Steps[len(flow.Steps)-1].(*catalog.Step)
		if last.StoreAccess == nil || last.StoreAccess.Method != "Save" {
			t.Errorf("%s does not reach the repository: %+v", name, flow.Steps)
		}
	}
	skipped := 0
	for _, warning := range response.Warnings() {
		if strings.HasPrefix(warning.Message, "http.route-skipped: ") {
			skipped++
			if !strings.Contains(warning.Ref, "internal/api/routes.go:") {
				t.Errorf("warning ref = %q", warning.Ref)
			}
		}
	}
	if skipped != 3 {
		t.Errorf("route warnings = %d, want 3: %+v", skipped, response.Warnings())
	}
}

// A route the reader cannot place under its prefix is skipped with the reason,
// not registered at the root.
func TestUnresolvedGroupPrefixIsSkippedWithAWarning(t *testing.T) {
	root := t.TempDir()
	writeQualitySource(t, root, "go.mod", "module example.com/gw\n")
	writeQualitySource(t, root, "web/gw.go", `package web
import "github.com/gin-gonic/gin"
type Handler struct{}
func (h *Handler) List(c *gin.Context) {}
func Router(h *Handler, version string) {
	e := gin.New()
	g := e.Group(version)
	g.GET("/items", h.List)
}
`)
	endpoints, skipped := serviceEndpointsAndSkips(root, "")
	if len(endpoints) != 0 {
		t.Fatalf("endpoints = %+v", endpoints)
	}
	if len(skipped) != 1 || !strings.Contains(skipped[0].message(), "sits under the prefix version") {
		t.Fatalf("skipped = %+v", skipped)
	}
}

// A router built in the function and mounted later carries the mount's
// prefix to routes registered on it before the mount.
func TestLocalSubRouterTakesItsMountPrefix(t *testing.T) {
	root := t.TempDir()
	writeQualitySource(t, root, "go.mod", "module example.com/mux\n")
	writeQualitySource(t, root, "web/routes.go", `package web
import (
	"net/http"

	"github.com/go-chi/chi/v5"
)
const admin = "/admin"
type Handler struct{}
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {}
func (h *Handler) Legacy(w http.ResponseWriter, r *http.Request) {}
func Routes(h *Handler) {
	r := chi.NewRouter()
	sub := chi.NewRouter()
	sub.Get("/stats", h.Stats)
	r.Mount(admin, sub)

	mux := http.NewServeMux()
	legacy := http.NewServeMux()
	legacy.HandleFunc("GET /v0", h.Legacy)
	mux.Handle("/old/", http.StripPrefix("/old", legacy))
}
`)
	endpoints, skipped := serviceEndpointsAndSkips(root, "")
	var labels []string
	for _, endpoint := range endpoints {
		labels = append(labels, endpoint.label)
	}
	sort.Strings(labels)
	if strings.Join(labels, ",") != "GET /admin/stats,GET /old/v0" || len(skipped) != 0 {
		t.Fatalf("endpoints = %v; skipped = %+v", labels, skipped)
	}
}
