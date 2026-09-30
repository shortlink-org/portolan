package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

const ordersTable = "sales_orders"

// Order is stored where its annotation says.
type Order struct {
	ent.Schema
}

func (Order) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.Enum("state").Values("draft", "placed"),
		field.Time("placed_at").Optional(),
	}
}

func (Order) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: ordersTable},
	}
}

// OrderLine takes ent's name for its type: order_lines.
type OrderLine struct {
	ent.Schema
}

func (OrderLine) Fields() []ent.Field {
	return []ent.Field{
		field.String("sku").StorageKey("sku_code"),
		field.Int("quantity"),
	}
}
