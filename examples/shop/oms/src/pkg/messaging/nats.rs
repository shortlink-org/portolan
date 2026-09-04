//! The bus over NATS JetStream: the way an event leaves this process for
//! another, and arrives from one (ADR oms.0001). One stream per service,
//! named for the first two segments of its subjects - `shop-oms` over
//! `shop.oms.>`, and `shop-cart` over the cart's - so a subscriber declares
//! the publisher's stream by the same rule and whichever side comes up first
//! makes it. The outbox row's topic is the subject, its uuid the message id the
//! stream deduplicates on, and its metadata rides as headers.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::Duration;

use async_nats::jetstream::consumer::pull;
use async_nats::jetstream::{self, stream};
use futures::StreamExt;

use super::{Bus, BusError, Handler, Message, deliver};

/// How long a stream remembers a message id: long enough for any relay retry.
const DUPLICATE_WINDOW: Duration = Duration::from_secs(2 * 60 * 60);

pub struct NatsBus {
    name: String,
    client: async_nats::Client,
    jetstream: jetstream::Context,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

impl NatsBus {
    pub async fn connect(url: &str, name: &str) -> Result<NatsBus, BusError> {
        let client = async_nats::ConnectOptions::new()
            .name(name)
            .connect(url)
            .await
            .map_err(|e| BusError(e.to_string()))?;
        let jetstream = jetstream::new(client.clone());
        Ok(NatsBus {
            name: name.to_string(),
            client,
            jetstream,
            tasks: Mutex::new(vec![]),
        })
    }

    /// The stream a subject belongs to, declared the same way by both ends.
    async fn stream_for(&self, subject: &str) -> Result<stream::Stream, BusError> {
        let (name, subjects) = stream_of(subject);
        self.jetstream
            .get_or_create_stream(stream::Config {
                name,
                subjects: vec![subjects],
                duplicate_window: DUPLICATE_WINDOW,
                ..Default::default()
            })
            .await
            .map_err(|e| BusError(e.to_string()))
    }
}

/// `shop.cart.basket` → the stream `shop-cart` over `shop.cart.>`.
pub fn stream_of(subject: &str) -> (String, String) {
    let parts: Vec<&str> = subject.split('.').collect();
    let head = if parts.len() >= 2 { parts[..2].to_vec() } else { parts.clone() };
    (head.join("-"), format!("{}.>", head.join(".")))
}

impl Bus for NatsBus {
    fn system(&self) -> &'static str {
        "nats"
    }

    /// At least once, like the relay: a repeat within the window is acknowledged as a duplicate and stored once.
    async fn publish(&self, message: Message) -> Result<(), BusError> {
        self.stream_for(&message.topic).await?;
        let mut headers = async_nats::HeaderMap::new();
        headers.insert(async_nats::header::NATS_MESSAGE_ID, message.uuid.as_str());
        for (key, value) in &message.metadata {
            headers.insert(key.as_str(), value.as_str());
        }
        let payload = serde_json::to_vec(&message.payload).map_err(|e| BusError(e.to_string()))?;
        let ack = self
            .jetstream
            .publish_with_headers(message.topic.clone(), headers, payload.into())
            .await
            .map_err(|e| BusError(e.to_string()))?;
        ack.await.map_err(|e| BusError(e.to_string()))?;
        Ok(())
    }

    /// A durable consumer named after the subscriber and the event, filtered
    /// on the subject, so a service that was down reads what it missed.
    async fn subscribe(&self, topic: &str, event: &str, handler: Handler) -> Result<(), BusError> {
        let wanted = event.to_string();
        let stream = self.stream_for(topic).await?;
        let durable = format!("{}-{}", self.name, event.replace('.', "-"));
        let consumer = stream
            .get_or_create_consumer(
                &durable,
                pull::Config {
                    durable_name: Some(durable.clone()),
                    filter_subject: topic.to_string(),
                    ack_policy: jetstream::consumer::AckPolicy::Explicit,
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| BusError(e.to_string()))?;
        let mut messages = consumer.messages().await.map_err(|e| BusError(e.to_string()))?;
        let system = self.system();
        let task = tokio::spawn(async move {
            while let Some(next) = messages.next().await {
                let Ok(m) = next else { continue };
                let mut metadata = BTreeMap::new();
                let mut uuid = String::new();
                if let Some(headers) = &m.headers {
                    for (key, values) in headers.iter() {
                        let value = values.first().map(|v| v.to_string()).unwrap_or_default();
                        if key.to_string() == async_nats::header::NATS_MESSAGE_ID.to_string() {
                            uuid = value;
                        } else {
                            metadata.insert(key.to_string(), value);
                        }
                    }
                }
                let payload = serde_json::from_slice(&m.payload).unwrap_or(serde_json::Value::Null);
                let message = Message {
                    uuid,
                    topic: m.subject.to_string(),
                    payload,
                    metadata,
                };
                if message.event_name() != wanted {
                    // Another event of the same aggregate: not this
                    // subscriber's, acknowledged unread.
                    let _ = m.ack().await;
                    continue;
                }
                match deliver(system, message, &handler).await {
                    Ok(()) => {
                        let _ = m.ack().await;
                    }
                    Err(err) => {
                        // Redelivered after the server's backoff; the handler
                        // is expected to be idempotent for the same reason
                        // the relay's repeats are tolerated.
                        tracing::warn!(error = %err, subject = %m.subject, "oms: subscriber failed; the message will come again");
                        let _ = m.ack_with(jetstream::AckKind::Nak(None)).await;
                    }
                }
            }
        });
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.push(task);
        }
        Ok(())
    }

    async fn close(&self) {
        let tasks: Vec<_> = self.tasks.lock().map(|mut t| t.drain(..).collect()).unwrap_or_default();
        for task in tasks {
            task.abort();
        }
        let _ = self.client.flush().await;
    }
}

#[cfg(test)]
mod tests {
    use super::stream_of;

    #[test]
    fn a_subject_names_its_stream_by_its_first_two_segments() {
        assert_eq!(stream_of("shop.cart.basket"), ("shop-cart".to_string(), "shop.cart.>".to_string()));
        assert_eq!(stream_of("shop.oms.order"), ("shop-oms".to_string(), "shop.oms.>".to_string()));
        assert_eq!(
            stream_of("payments.ledger.payment"),
            ("payments-ledger".to_string(), "payments.ledger.>".to_string())
        );
    }
}
