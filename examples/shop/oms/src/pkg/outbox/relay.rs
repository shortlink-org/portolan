//! The relay: reads the outbox and hands what is in it to the bus, marking each
//! row published. It runs for as long as the service does, and its failure is
//! as fatal as the listener's - a service that serves but never delivers what
//! it recorded is worse than one that is plainly down.

use std::collections::BTreeMap;
use std::time::Duration;

use sqlx::{PgPool, Row};
use tracing::Instrument;

use crate::pkg::messaging::tracing::{carry, relay_span};
use crate::pkg::messaging::{Bus, BusError, Message};

const POLL: Duration = Duration::from_millis(200);
const BATCH: i64 = 50;

pub struct Relay<B: Bus> {
    pool: PgPool,
    bus: B,
}

impl<B: Bus> Relay<B> {
    pub fn new(pool: PgPool, bus: B) -> Relay<B> {
        Relay { pool, bus }
    }

    pub fn bus(&self) -> &B {
        &self.bus
    }

    pub async fn run(&self, mut stop: tokio::sync::watch::Receiver<bool>) -> Result<(), BusError> {
        while !*stop.borrow() {
            let delivered = self.once().await?;
            if delivered == 0 {
                tokio::select! {
                    _ = tokio::time::sleep(POLL) => {}
                    _ = stop.changed() => {}
                }
            }
        }
        Ok(())
    }

    /// One batch, oldest first, each row on its own so a slow subscriber holds up nothing else.
    pub async fn once(&self) -> Result<usize, BusError> {
        let rows = sqlx::query("SELECT id, uuid, topic, payload, metadata FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT $1")
            .bind(BATCH)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| BusError(e.to_string()))?;
        let count = rows.len();
        for row in rows {
            let id: i64 = row.try_get("id").map_err(|e| BusError(e.to_string()))?;
            let metadata: serde_json::Value = row.try_get("metadata").map_err(|e| BusError(e.to_string()))?;
            // A copy of the metadata: the span moves the trace context on to
            // itself for whoever reads the message, and the row keeps what
            // was written.
            let mut metadata: BTreeMap<String, String> = serde_json::from_value(metadata).unwrap_or_default();
            let message_topic: String = row.try_get("topic").map_err(|e| BusError(e.to_string()))?;
            let event_name = metadata
                .get(crate::pkg::messaging::METADATA_EVENT_NAME)
                .cloned()
                .unwrap_or_else(|| message_topic.clone());
            let span = relay_span(self.bus.system(), &message_topic, &event_name, &metadata);
            carry(&span, &mut metadata);
            let message = Message {
                uuid: row.try_get("uuid").map_err(|e| BusError(e.to_string()))?,
                topic: message_topic,
                payload: row.try_get("payload").map_err(|e| BusError(e.to_string()))?,
                metadata,
            };
            async {
                self.bus.publish(message).await?;
                sqlx::query("UPDATE outbox SET published_at = now() WHERE id = $1")
                    .bind(id)
                    .execute(&self.pool)
                    .await
                    .map_err(|e| BusError(e.to_string()))?;
                Ok::<(), BusError>(())
            }
            .instrument(span)
            .await?;
        }
        Ok(count)
    }
}
