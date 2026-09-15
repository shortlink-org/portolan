package goscan

import (
	"go/parser"
	"go/token"
	"reflect"
	"testing"
)

func TestImportNameIsThePackageNameAPathSuggests(t *testing.T) {
	cases := []struct{ spec, want string }{
		{`"net/http"`, "http"},
		{`"fmt"`, "fmt"},
		{`"github.com/go-resty/resty/v2"`, "resty"},
		{`"github.com/jackc/pgx/v5"`, "pgx"},
		{`"github.com/go-playground/validator/v10"`, "validator"},
		{`"github.com/redis/go-redis/v9"`, "redis"},
		{`"github.com/go-redis/redis/v9"`, "redis"},
		{`"github.com/google/go-github/v60/github"`, "github"},
		{`"gopkg.in/yaml.v3"`, "yaml"},
		{`"github.com/nats-io/nats.go"`, "nats"},
		{`"github.com/segmentio/kafka-go"`, "kafka"},
		{`"k8s.io/api/core/v1"`, "v1"},
		{`"example.com/m/v0"`, "v0"},
		{`"example.com/m/v02"`, "v02"},
		{`"v2"`, "v2"},
		{`pg "github.com/jackc/pgx/v5"`, "pg"},
		{`_ "github.com/lib/pq"`, "_"},
		{`. "github.com/onsi/gomega"`, "."},
	}
	for _, c := range cases {
		node, err := parser.ParseFile(token.NewFileSet(), "x.go", "package x\nimport "+c.spec+"\n", parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		if got := ImportName(node.Imports[0]); got != c.want {
			t.Errorf("ImportName(%s) = %q, want %q", c.spec, got, c.want)
		}
	}
}

func TestAVersionedImportIsKnownByItsPackageName(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/m\n")
	write(t, root, "main.go", "package main\n\nimport (\n\t\"github.com/jackc/pgx/v5\"\n\t_ \"github.com/lib/pq\"\n\tr \"github.com/go-resty/resty/v2\"\n)\n")
	out, err := Read(root)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"pgx": "github.com/jackc/pgx/v5",
		"pq":  "github.com/lib/pq",
		"r":   "github.com/go-resty/resty/v2",
	}
	if got := out.Files[0].Imports; !reflect.DeepEqual(got, want) {
		t.Errorf("imports: got %v, want %v", got, want)
	}
}

// A package in the tree says what it is called, and that beats the guess.
func TestATreePackageIsKnownByItsPackageClause(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/m\n")
	write(t, root, "go-client/v2/client.go", "package clients\n")
	write(t, root, "main.go", "package main\n\nimport \"example.com/m/go-client/v2\"\n")
	out, err := Read(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range out.Files {
		if file.Name != "main.go" {
			continue
		}
		want := map[string]string{"clients": "example.com/m/go-client/v2"}
		if !reflect.DeepEqual(file.Imports, want) {
			t.Errorf("imports: got %v, want %v", file.Imports, want)
		}
	}
}
