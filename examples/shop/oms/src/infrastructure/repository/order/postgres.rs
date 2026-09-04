use std::collections::BTreeMap;

use sqlx::{PgPool, Row};
use tracing::Instrument;

use super::TOPIC;
use crate::domain::order::event::Event;
use crate::domain::order::port::Orders;
use crate::domain::order::vo::Money;
use crate::domain::order::{Error, Line, Order, Status};
use crate::pkg::messaging::METADATA_EVENT_NAME;
use crate::pkg::messaging::tracing::{carry, publish_span};
use crate::telemetry::db_span;

/// Orders in Postgres. Every write is one transaction: the order, its lines,
/// and one outbox row per event, so an event cannot be published before the
/// order exists or lost after it does.
#[derive(Clone)]
pub struct PostgresOrders {
    pool: PgPool,
}

impl PostgresOrders {
    pub fn new(pool: PgPool) -> PostgresOrders {
        PostgresOrders { pool }
    }

    async fn hydrate(&self, row: sqlx::postgres::PgRow) -> Result<Order, Error> {
        let id: String = row.try_get("id").map_err(store)?;
        let lines = sqlx::query("SELECT sku, quantity, unit_price_minor, currency FROM order_lines WHERE order_id = $1 ORDER BY sku")
            .bind(&id)
            .fetch_all(&self.pool)
            .instrument(db_span("SELECT", "order_lines"))
            .await
            .map_err(store)?
            .into_iter()
            .map(|l| {
                Ok(Line {
                    sku: l.try_get("sku").map_err(store)?,
                    quantity: l.try_get::<i32, _>("quantity").map_err(store)? as u32,
                    unit_price: Money::of(
                        l.try_get("unit_price_minor").map_err(store)?,
                        l.try_get::<String, _>("currency").map_err(store)?.as_str(),
                    ),
                })
            })
            .collect::<Result<Vec<Line>, Error>>()?;
        let status: String = row.try_get("status").map_err(store)?;
        Ok(Order {
            id,
            customer_id: row.try_get("customer_id").map_err(store)?,
            basket_id: row.try_get("basket_id").map_err(store)?,
            lines,
            total: Money::of(
                row.try_get("total_minor").map_err(store)?,
                row.try_get::<String, _>("currency").map_err(store)?.as_str(),
            ),
            status: Status::parse(&status).ok_or_else(|| Error::Store(format!("unknown status {status}")))?,
            placed_at: row.try_get("placed_at").map_err(store)?,
            version: row.try_get::<i32, _>("version").map_err(store)? as u32,
        })
    }

    /// One row per event, with the publishing span's context on its metadata,
    /// so the consumer continues the trace.
    async fn enqueue(&self, tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, event: &dyn Event) -> Result<(), Error> {
        let mut metadata: BTreeMap<String, String> = BTreeMap::new();
        metadata.insert(METADATA_EVENT_NAME.into(), event.name().into());
        let span = publish_span("outbox", TOPIC, event.name());
        carry(&span, &mut metadata);
        sqlx::query("INSERT INTO outbox (uuid, topic, payload, metadata, created_at) VALUES ($1, $2, $3, $4, $5)")
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(TOPIC)
            .bind(event.payload())
            .bind(serde_json::to_value(&metadata).unwrap_or_default())
            .bind(event.occurred_at())
            .execute(&mut **tx)
            .instrument(span)
            .await
            .map_err(store)?;
        Ok(())
    }
}

impl Orders for PostgresOrders {
    async fn by_id(&self, id: &str) -> Result<Order, Error> {
        let row = sqlx::query("SELECT id, customer_id, basket_id, status, total_minor, currency, placed_at, version FROM orders WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .instrument(db_span("SELECT", "orders"))
            .await
            .map_err(store)?
            .ok_or_else(|| Error::NotFound(id.to_string()))?;
        self.hydrate(row).await
    }

    async fn by_basket(&self, basket_id: &str) -> Result<Option<Order>, Error> {
        let row = sqlx::query("SELECT id, customer_id, basket_id, status, total_minor, currency, placed_at, version FROM orders WHERE basket_id = $1")
            .bind(basket_id)
            .fetch_optional(&self.pool)
            .instrument(db_span("SELECT", "orders"))
            .await
            .map_err(store)?;
        match row {
            Some(row) => Ok(Some(self.hydrate(row).await?)),
            None => Ok(None),
        }
    }

    async fn save(&self, order: &Order, events: &[&dyn Event]) -> Result<(), Error> {
        let mut tx = self.pool.begin().await.map_err(store)?;
        let next_version = i32::try_from(order.version + 1).map_err(|e| Error::Store(e.to_string()))?;
        if order.version == 0 {
            sqlx::query(
                "INSERT INTO orders (id, customer_id, basket_id, status, total_minor, currency, placed_at, version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(&order.id)
            .bind(&order.customer_id)
            .bind(&order.basket_id)
            .bind(order.status.as_str())
            .bind(order.total.amount_minor)
            .bind(&order.total.currency)
            .bind(order.placed_at)
            .bind(next_version)
            .execute(&mut *tx)
            .instrument(db_span("INSERT", "orders"))
            .await
            .map_err(|e| if is_unique_violation(&e) { Error::Conflict } else { store(e) })?;
        } else {
            let updated = sqlx::query("UPDATE orders SET status = $2, version = $3 WHERE id = $1 AND version = $4")
                .bind(&order.id)
                .bind(order.status.as_str())
                .bind(next_version)
                .bind(next_version - 1)
                .execute(&mut *tx)
                .instrument(db_span("UPDATE", "orders"))
                .await
                .map_err(store)?;
            if updated.rows_affected() != 1 {
                return Err(Error::Conflict);
            }
        }
        sqlx::query("DELETE FROM order_lines WHERE order_id = $1")
            .bind(&order.id)
            .execute(&mut *tx)
            .instrument(db_span("DELETE", "order_lines"))
            .await
            .map_err(store)?;
        for line in &order.lines {
            sqlx::query("INSERT INTO order_lines (order_id, sku, quantity, unit_price_minor, currency) VALUES ($1, $2, $3, $4, $5)")
                .bind(&order.id)
                .bind(&line.sku)
                .bind(i32::try_from(line.quantity).map_err(|e| Error::Store(e.to_string()))?)
                .bind(line.unit_price.amount_minor)
                .bind(&line.unit_price.currency)
                .execute(&mut *tx)
                .instrument(db_span("INSERT", "order_lines"))
                .await
                .map_err(store)?;
        }
        for event in events {
            self.enqueue(&mut tx, *event).await?;
        }
        tx.commit().await.map_err(store)?;
        Ok(())
    }
}

fn store(e: sqlx::Error) -> Error {
    Error::Store(e.to_string())
}

fn is_unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.code().as_deref() == Some("23505"))
}
