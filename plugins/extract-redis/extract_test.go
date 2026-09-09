package extractredis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func writeGo(t *testing.T, root, name, contents string) {
	t.Helper()
	file := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func extracted(t *testing.T, root string, opts Options) (catalog.Catalog, plugin.Response) {
	t.Helper()
	response, err := extract(plugin.Input{Root: root, Commit: "abc", GeneratedAt: "2026-01-01T00:00:00Z"}, opts)
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	return out, response
}

func TestExtractsGoRedisConstructionAsOwnedStore(t *testing.T) {
	root := t.TempDir()
	writeGo(t, root, "go.mod", "module example.com/cache\n")
	writeGo(t, root, "internal/cache/redis.go", `package cache
import redisv9 "github.com/redis/go-redis/v9"
func New() *redisv9.Client {
  return redisv9.NewClient(&redisv9.Options{Addr: "localhost:6379"})
}
`)

	out, response := extracted(t, root, Options{Context: "sales", Service: "catalog"})
	if len(response.Warnings()) != 0 {
		t.Fatalf("warnings = %+v", response.Warnings())
	}
	if out.Commit != "abc" || out.GeneratedAt != "2026-01-01T00:00:00Z" {
		t.Fatalf("stamp = %q %q", out.Commit, out.GeneratedAt)
	}
	if len(out.Stores) != 1 {
		t.Fatalf("stores = %+v", out.Stores)
	}
	store := out.Stores[0]
	if store.ID != "sales.catalog.redis" || store.Owner != "sales.catalog" || store.Kind != catalog.StoreKindRedis || store.Name != "catalog Redis" {
		t.Fatalf("store = %+v", store)
	}
	if store.Source != "internal/cache/redis.go:4" || store.Tables == nil || len(store.Tables) != 0 {
		t.Fatalf("source/tables = %q %+v", store.Source, store.Tables)
	}
	service := out.Contexts[0].Services[0]
	if len(service.Stores) != 1 || service.Stores[0] != store.ID {
		t.Fatalf("service stores = %+v", service.Stores)
	}
}

func TestResolvesThePackageNameOfAVersionedGoRedisImport(t *testing.T) {
	root := t.TempDir()
	writeGo(t, root, "go.mod", "module example.com/cache\n")
	writeGo(t, root, "redis.go", `package cache
import "github.com/redis/go-redis/v9"
func connect() { _ = redis.NewClient(&redis.Options{}) }
`)

	out, _ := extracted(t, root, Options{Context: "sales", Service: "catalog"})
	if len(out.Stores) != 1 {
		t.Fatalf("stores = %+v", out.Stores)
	}
}

func TestExtractsKeyPatternsOperationsTTLAndValueTypes(t *testing.T) {
	root := t.TempDir()
	writeGo(t, root, "go.mod", "module example.com/cache\n")
	writeGo(t, root, "cache.go", `package cache
import (
  "context"
  "encoding/json"
  "time"
  "github.com/redis/go-redis/v9"
)
const sessionTTL = 24 * time.Hour
type Session struct { ID string }
type Cache struct { client *redis.Client }
func New() *Cache { return &Cache{client: redis.NewClient(&redis.Options{})} }
func sessionKey(id string) string { return "session:" + id }
func (c *Cache) Save(ctx context.Context, id string, session Session) error {
  data, _ := json.Marshal(session)
  return c.client.Set(ctx, sessionKey(id), data, sessionTTL).Err()
}
func (c *Cache) Load(ctx context.Context, id string) error {
  return c.client.Get(ctx, sessionKey(id)).Err()
}
func (c *Cache) Delete(ctx context.Context, id string) error {
  return c.client.Del(ctx, sessionKey(id)).Err()
}
func (c *Cache) Query(ctx context.Context, provider, pnr string, value []byte, ttl time.Duration) error {
  key := "query_" + provider
  if pnr != "" { key = key + "_" + pnr }
  return c.client.Set(ctx, key, value, ttl).Err()
}
`)

	out, _ := extracted(t, root, Options{Context: "sales", Service: "catalog"})
	keyspaces := out.Stores[0].Keyspaces
	if len(keyspaces) != 2 {
		t.Fatalf("keyspaces = %+v", keyspaces)
	}
	if got := keyspaces[1]; got.Pattern != "session:{id}" || got.TTL != "24h" || got.Value != "Session" ||
		len(got.Operations) != 3 || got.Operations[0] != catalog.RedisOperationRead || got.Operations[1] != catalog.RedisOperationWrite || got.Operations[2] != catalog.RedisOperationDelete {
		t.Fatalf("session keyspace = %+v", got)
	}
	if got := keyspaces[0]; got.Pattern != "query_{provider}[_{pnr}]" || got.TTL != "caller-provided (ttl)" || got.Value != "[]byte" {
		t.Fatalf("query keyspace = %+v", got)
	}
}

func TestExtractsProtoJSONAggregateAccessesAndSelectorKeys(t *testing.T) {
	root := t.TempDir()
	writeGo(t, root, "go.mod", "module example.com/books\n")
	writeGo(t, root, "redis.go", `package books
import (
  "context"
  "github.com/redis/go-redis/v9"
  "google.golang.org/protobuf/encoding/protojson"
)
type Book struct { Title string }
type Store struct { client *redis.Client }
func New() *Store { return &Store{client: redis.NewClient(&redis.Options{})} }
func (s *Store) Get(ctx context.Context, id string) (*Book, error) {
  value, err := s.client.Get(ctx, id).Result()
  if err != nil { return nil, err }
  var book Book
  if err := protojson.Unmarshal([]byte(value), &book); err != nil { return nil, err }
  return &book, nil
}
func (s *Store) Add(ctx context.Context, in *Book) (*Book, error) {
  m := protojson.MarshalOptions{}
  value, _ := m.Marshal(in)
  if err := s.client.Set(ctx, in.Title, value, 0).Err(); err != nil { return nil, err }
  return in, nil
}
func (s *Store) Update(ctx context.Context, in *Book) (*Book, error) {
  m := protojson.MarshalOptions{}
  value, _ := m.Marshal(in)
  if err := s.client.Set(ctx, in.Title, value, 0).Err(); err != nil { return nil, err }
  return in, nil
}
`)

	out, _ := extracted(t, root, Options{Context: "library", Service: "book"})
	keyspaces := out.Stores[0].Keyspaces
	if len(keyspaces) != 2 {
		t.Fatalf("keyspaces = %+v", keyspaces)
	}
	read := keyspaces[0]
	if read.Pattern != "{id}" || read.Value != "Book" || len(read.Accesses) != 1 || read.Accesses[0].Method != "Store.Get" || read.Accesses[0].Operation != catalog.RedisOperationRead {
		t.Fatalf("read keyspace = %+v", read)
	}
	written := keyspaces[1]
	if written.Pattern != "{in.Title}" || written.Value != "Book" || written.TTL != "none" || len(written.Accesses) != 2 || written.Accesses[0].Method != "Store.Add" || written.Accesses[1].Method != "Store.Update" {
		t.Fatalf("written keyspace = %+v", written)
	}
}

func TestRecognizesSupportedRedisClients(t *testing.T) {
	cases := []struct {
		name       string
		importPath string
		call       string
	}{
		{name: "go redis v8", importPath: "github.com/go-redis/redis/v8", call: "NewClusterClient(&client.ClusterOptions{})"},
		{name: "rueidis", importPath: "github.com/redis/rueidis", call: "NewClient(client.ClientOption{})"},
		{name: "redigo", importPath: "github.com/gomodule/redigo/redis", call: `DialURL("redis://localhost")`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			writeGo(t, root, "go.mod", "module example.com/cache\n")
			writeGo(t, root, "redis.go", "package cache\nimport client \""+tc.importPath+"\"\nfunc connect() { _, _ = client."+tc.call+" }\n")
			out, _ := extracted(t, root, Options{Context: "sales", Service: "catalog"})
			if len(out.Stores) != 1 {
				t.Fatalf("stores = %+v", out.Stores)
			}
		})
	}
}

func TestDependencyOrUnrelatedRedisPackageIsNotRuntimeEvidence(t *testing.T) {
	root := t.TempDir()
	writeGo(t, root, "go.mod", "module example.com/cache\nrequire github.com/redis/go-redis/v9 v9.0.0\n")
	writeGo(t, root, "redis.go", `package cache
import redis "example.com/cache/redis"
func connect() { redis.NewClient() }
`)

	out, response := extracted(t, root, Options{Context: "sales", Service: "catalog"})
	if len(out.Stores) != 0 || len(out.Contexts[0].Services[0].Stores) != 0 {
		t.Fatalf("unexpected store = %+v", out.Stores)
	}
	if len(response.Warnings()) != 1 {
		t.Fatalf("warnings = %+v", response.Warnings())
	}
}
