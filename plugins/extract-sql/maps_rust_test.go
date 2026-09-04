package main

import (
	"testing"
)

// The same rule as for Go and TypeScript, read off text: the chain from the
// aggregate, a borrow or a dereference in front of it, one conversion round
// it, a method on the value stripped.
func TestFieldOfRustFollowsTheChainBorrowsAndOneWrapper(t *testing.T) {
	cases := map[string]string{
		"order.id":                       "id",
		"&order.customer_id":             "customer_id",
		"&mut order.lines":               "lines",
		"*order.version":                 "version",
		"order.status.as_str()":          "status",
		"order.total.amount_minor":       "total.amount_minor",
		"order.total.currency.code()":    "total.currency",
		"Some(order.placed_at)":          "placed_at",
		"i64::from(order.version)":       "version",
		"order.basket_id.to_string()":    "basket_id",
		"&order.customer_id.as_deref()?": "customer_id",
		"Uuid::new_v4()":                 "",
		"serde_json::to_value(&event)?":  "",
		"combine(order.a, order.b)":      "",
		"TOPIC":                          "",
		"1":                              "",
		"\"literal\"":                    "",
		"Utc::now()":                     "",
	}
	for in, want := range cases {
		if got := fieldOfRust(in); got != want {
			t.Errorf("fieldOfRust(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRustInsertCallsReadBothShapesAndStepOverLifetimes(t *testing.T) {
	source := `
impl<'a> PostgresOrders<'a> {
    async fn save(&self, tx: &mut Transaction<'_, Postgres>, order: &Order) -> Result<(), Error> {
        sqlx::query("BEGIN").execute(&mut **tx).await?; // a literal before, which must not swallow what follows
        let sep = ',';
        sqlx::query(
            r#"INSERT INTO orders (id, customer_id, version) VALUES ($1, $2, 1)"#,
        )
        .bind(order.id)
        // the customer auth vouched for
        .bind(&order.customer_id)
        .execute(&mut **tx)
        .await?;
        let rows = sqlx::query("SELECT * FROM orders WHERE id = $1").bind(id).fetch_all(pool).await?;
        sqlx::query!("INSERT INTO outbox (uuid, payload) VALUES ($1, $2)", Uuid::new_v4(), serde_json::to_value(&event)?)
            .execute(&mut **tx)
            .await?;
        Ok(())
    }
}
`
	calls := rustInsertCalls(source)
	if len(calls) != 2 {
		t.Fatalf("found %d inserts, want 2", len(calls))
	}
	if len(calls[0].args) != 2 || calls[0].args[1] != "&order.customer_id" {
		t.Fatalf("first insert args = %q", calls[0].args)
	}
	if len(calls[1].args) != 2 || calls[1].args[1] != "serde_json::to_value(&event)?" {
		t.Fatalf("second insert args = %q", calls[1].args)
	}
}
