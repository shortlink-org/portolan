package goscan

import (
	"go/ast"
	"reflect"
	"testing"
)

// A package outside the module is found through a replace to a directory,
// under the module path the importer uses; one only the module cache has is
// not found at all.
func TestLocateFollowsADirectoryReplace(t *testing.T) {
	root := t.TempDir()
	write(t, root, "svc/go.mod", `module example.com/svc

go 1.24

require (
	example.com/ddd v0.0.0
	example.com/remote v1.2.3
)

replace example.com/ddd => ../ddd

replace example.com/remote v1.2.3 => example.com/fork v1.2.4
`)
	write(t, root, "svc/internal/order/event.go", "package order\n")
	write(t, root, "ddd/go.mod", "module example.com/ddd\n")
	write(t, root, "ddd/event/event.go", "package event\n\nconst Kind = \"fact\"\n")

	tree, err := Read(root + "/svc")
	if err != nil {
		t.Fatal(err)
	}

	local, dir, ok := tree.Locate("example.com/svc/internal/order")
	if !ok || local != tree || dir != "internal/order" {
		t.Fatalf("own package = %v %q %v", local == tree, dir, ok)
	}

	foreign, dir, ok := tree.Locate("example.com/ddd/event")
	if !ok || dir != "event" || len(foreign.PackageFiles("event")) != 1 {
		t.Fatalf("replaced package = %q %v", dir, ok)
	}
	if foreign.Module != "example.com/ddd" || foreign.ConstantString("example.com/ddd/event.Kind", nil) != "fact" {
		t.Fatalf("replaced tree keyed as %q", foreign.Module)
	}
	again, _, _ := tree.Locate("example.com/ddd/event")
	if again != foreign {
		t.Fatal("a replaced package was read twice")
	}

	for _, missing := range []string{"example.com/remote/pkg", "fmt", "example.com/ddd/nothing"} {
		if _, _, ok := tree.Locate(missing); ok {
			t.Errorf("%s should not be found", missing)
		}
	}
}

func TestEmbeddedName(t *testing.T) {
	ddd := func(name string) ast.Expr {
		return &ast.SelectorExpr{X: &ast.Ident{Name: "ddd"}, Sel: &ast.Ident{Name: name}}
	}
	for _, tc := range []struct {
		expr ast.Expr
		want string
	}{
		{&ast.Ident{Name: "Base"}, "Base"},
		{&ast.StarExpr{X: ddd("Base")}, "Base"},
		{&ast.IndexExpr{X: ddd("Root"), Index: &ast.Ident{Name: "ID"}}, "Root"},
		{&ast.ArrayType{Elt: &ast.Ident{Name: "Base"}}, ""},
	} {
		if got := EmbeddedName(tc.expr); got != tc.want {
			t.Errorf("EmbeddedName = %q, want %q", got, tc.want)
		}
	}
}

func embeddingIndex(t *testing.T) *Index {
	t.Helper()
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "base/base.go", `package base

type Base struct {
	id    string
	topic string `+"`default:\"orders\"`"+`
}

func (b Base) ID() string { return b.id }

type Named struct{ id string }

func (Named) Label() string { return "named" }

type Reader interface{ Read() }
type Writer interface{ Write() }
type Store interface {
	Reader
	Writer
	Close()
}
`)
	write(t, root, "order/order.go", `package order

import "example.com/svc/base"

type Order struct {
	*base.Base
	base.Named
	base.Reader
	total int
}

type Shadowing struct {
	base.Base
	id int
}

type Deep struct{ Order }

type Postgres struct{ base.Base }

func (Postgres) Read()  {}
func (Postgres) Write() {}
func (Postgres) Close() {}
`)
	tree, err := Read(root)
	if err != nil {
		t.Fatal(err)
	}
	return NewIndex(tree)
}

// Fields an embedded struct declares are the embedding struct's too, by the
// language's selector rule: the shallower one wins, and two at one depth hide
// each other.
func TestEmbeddedStructsPromoteTheirFields(t *testing.T) {
	s := embeddingIndex(t)

	order := s.Structs["example.com/svc/order.Order"]
	if order.Fields["Base"] != "example.com/svc/base.Base" || order.Fields["total"] != "int" {
		t.Fatalf("own and embedded fields = %v", order.Fields)
	}
	if order.Fields["topic"] != "string" || order.Defaults["topic"] != "orders" {
		t.Errorf("a promoted field keeps its type and default, got %v %v", order.Fields, order.Defaults)
	}
	if _, ambiguous := order.Fields["id"]; ambiguous {
		t.Errorf("Base.id and Named.id are at one depth and hide each other, got %q", order.Fields["id"])
	}
	if !reflect.DeepEqual(order.Embedded, []string{"example.com/svc/base.Base", "example.com/svc/base.Named", "example.com/svc/base.Reader"}) {
		t.Errorf("embedded = %v", order.Embedded)
	}

	if got := s.Structs["example.com/svc/order.Shadowing"].Fields["id"]; got != "int" {
		t.Errorf("an own field hides the promoted one, got %q", got)
	}
	if got := s.Structs["example.com/svc/order.Deep"].Fields["topic"]; got != "string" {
		t.Errorf("promotion goes through every level, got %q", got)
	}
}

// A method an embedded type declares is called on the embedding type; one an
// embedded interface asks for is dispatched to whatever implements it.
func TestEmbeddedTypesPromoteTheirMethods(t *testing.T) {
	s := embeddingIndex(t)

	if fn := s.Method("example.com/svc/order.Order", "ID"); fn == nil || fn.Key != "example.com/svc/base.Base.ID" {
		t.Fatalf("promoted method = %+v", fn)
	}
	if fn := s.Method("example.com/svc/order.Deep", "Label"); fn == nil || fn.Key != "example.com/svc/base.Named.Label" {
		t.Errorf("a method promoted two levels down = %+v", fn)
	}
	if fn, iface := s.promotedMethod("example.com/svc/order.Order", "Read"); fn != nil || iface != "example.com/svc/base.Reader" {
		t.Errorf("an embedded interface's method = %+v %q", fn, iface)
	}
	if !s.Implements("example.com/svc/order.Order", "example.com/svc/base.Reader") {
		t.Error("an embedded interface's methods count towards what a struct implements")
	}
}

// An interface asks for what the interfaces it embeds ask for.
func TestEmbeddedInterfacesAreFolded(t *testing.T) {
	s := embeddingIndex(t)

	if got := s.Interfaces["example.com/svc/base.Store"]; !reflect.DeepEqual(got, []string{"Close", "Read", "Write"}) {
		t.Fatalf("Store = %v", got)
	}
	if !s.Implements("example.com/svc/order.Postgres", "example.com/svc/base.Store") {
		t.Error("Postgres has Read, Write and Close")
	}
	if s.Implements("example.com/svc/order.Order", "example.com/svc/base.Store") {
		t.Error("Order has only Read of Store, and Store asks for all three")
	}
}
