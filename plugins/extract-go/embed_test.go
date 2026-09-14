package extractgo

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
)

// A workspace the way examples/auth is laid out: the service module replaces
// the shared ddd module with a directory beside it, and its events embed the
// base from there.
func embeddingWorkspace(t *testing.T) (string, *goscan.Tree) {
	t.Helper()
	root := t.TempDir()
	writeTree(t, root, map[string]string{
		"ddd/go.mod": "module example.com/ddd\n",
		"ddd/event/event.go": `package event

import "time"

// Base is what every event carries.
type Base struct {
	// aggregateID is whose fact this is.
	aggregateID string
	occurredAt  time.Time
}

func (b Base) AggregateID() string { return b.aggregateID }
`,
		"svc/go.mod": `module example.com/svc

go 1.24

require example.com/ddd v0.0.0

replace example.com/ddd => ../ddd
`,
		"svc/internal/order/domain/event/event.go": `package event

import (
	"io"
	"time"

	ddd "example.com/ddd/event"
	"example.com/svc/internal/order/domain/shared"
)

const TopicPlaced = "shop.OrderPlaced"

// named gives an event its wire name.
type named struct{}

func (named) Name() string { return TopicPlaced }

// Placed is published when an order is placed.
type Placed struct {
	ddd.Base
	total int
}

func (Placed) Name() string { return TopicPlaced }

// Shipped carries its own occurredAt, which hides the base's.
type Shipped struct {
	*ddd.Base
	occurredAt string
	io.Reader
}

func (Shipped) Name() string { return "shop.OrderShipped" }

// Cancelled takes its name from what it embeds.
type Cancelled struct {
	named
	shared.Audit
}

// Ambiguous embeds two structs with the same field at one depth.
type Ambiguous struct {
	shared.Audit
	shared.Trail
}

func (Ambiguous) Name() string { return "shop.Ambiguous" }
`,
		"svc/internal/order/domain/shared/shared.go": `package shared

type Audit struct{ by string }

type Trail struct{ by string }

type Reader interface {
	ByID(id string) (*Order, error)
}

type Repository interface {
	Reader
	Save(o *Order) error
}

type Order struct{}
`,
	})
	tree, err := goscan.ReadWithOptions(filepath.Join(root, "svc"), goscan.ReadOptions{IncludeGenerated: true, AllowPartial: true})
	if err != nil {
		t.Fatal(err)
	}

	return filepath.Join(root, "svc"), tree
}

func eventNamed(events []catalog.Event, name string) catalog.Event {
	for _, event := range events {
		if event.Name == name {
			return event
		}
	}

	return catalog.Event{}
}

func fieldRows(fields []catalog.Field) []string {
	out := make([]string, len(fields))
	for i, field := range fields {
		out[i] = field.Name + " " + field.Type
	}

	return out
}

// An embedded struct's fields stand where it is embedded, read through the
// go.mod replace; a type the workspace does not have stays one row, named
// the way the language names the field.
func TestEventFieldsUnpackEmbeddedStructs(t *testing.T) {
	root, tree := embeddingWorkspace(t)
	pkg, err := parsePkg(root, "internal/order/domain/event", tree)
	if err != nil {
		t.Fatal(err)
	}
	events := eventsIn(pkg, "shop.order.order", "")

	placed := eventNamed(events, "Placed")
	if got := fieldRows(placed.Versions[0].Fields); !reflect.DeepEqual(got, []string{"aggregateID string", "occurredAt time.Time", "total int"}) {
		t.Fatalf("Placed fields = %v", got)
	}
	if doc := placed.Versions[0].Fields[0].Doc; doc != "aggregateID is whose fact this is." {
		t.Errorf("a promoted field keeps its own doc, got %q", doc)
	}

	shipped := eventNamed(events, "Shipped")
	if got := fieldRows(shipped.Versions[0].Fields); !reflect.DeepEqual(got, []string{"aggregateID string", "occurredAt string", "Reader io.Reader"}) {
		t.Errorf("Shipped fields = %v; its own occurredAt hides the base's, and io.Reader is not in the workspace", got)
	}

	ambiguous := eventNamed(events, "Ambiguous")
	if got := fieldRows(ambiguous.Versions[0].Fields); len(got) != 0 {
		t.Errorf("two `by` fields at one depth hide each other, got %v", got)
	}
}

// Name may be promoted from an embedded type, and its constant is read where
// that type is declared.
func TestEventNameMayBePromoted(t *testing.T) {
	root, tree := embeddingWorkspace(t)
	pkg, err := parsePkg(root, "internal/order/domain/event", tree)
	if err != nil {
		t.Fatal(err)
	}

	cancelled := eventNamed(eventsIn(pkg, "shop.order.order", ""), "Cancelled")
	if cancelled.Wire == nil || cancelled.Wire.Name != "shop.OrderPlaced" {
		t.Fatalf("Cancelled = %+v", cancelled)
	}
	if got := fieldRows(cancelled.Versions[0].Fields); !reflect.DeepEqual(got, []string{"by string"}) {
		t.Errorf("Cancelled fields = %v", got)
	}

	owner, fn := pkg.method("Placed", "AggregateID")
	if fn == nil || owner.name != "event" || filepath.Base(owner.dir) != "event" || owner.index.Module != "example.com/ddd" {
		t.Errorf("AggregateID should come from the ddd module, got %v", fn)
	}
}

// A port asks for what the interfaces it embeds ask for.
func TestPortMethodsComeThroughEmbeddedInterfaces(t *testing.T) {
	root, tree := embeddingWorkspace(t)
	pkg, err := parsePkg(root, "internal/order/domain/shared", tree)
	if err != nil {
		t.Fatal(err)
	}
	decl, ok := pkg.typeNamed("Repository")
	if !ok {
		t.Fatal("Repository not found")
	}

	for _, name := range []string{"ByID", "Save"} {
		if _, fn := interfaceMethod(decl, name); fn == nil {
			t.Errorf("Repository should ask for %s", name)
		}
	}
	if _, fn := interfaceMethod(decl, "Delete"); fn != nil {
		t.Error("Repository does not ask for Delete")
	}
}
