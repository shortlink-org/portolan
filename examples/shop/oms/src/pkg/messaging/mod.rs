//! The bus: what the relay delivers to and what a policy subscribes on. A
//! message is what the outbox row held; the event's name is on its metadata,
//! so a subscriber dispatches without parsing the payload.
//!
//! Two of them, as in the cart: in process, for running alone and for the
//! tests; over NATS JetStream when NATS_URL names a server, which is how an
//! event reaches another service and how the cart's reach this one.

pub mod inproc;
pub mod nats;
pub mod tracing;

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

pub const METADATA_EVENT_NAME: &str = "event_name";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub uuid: String,
    pub topic: String,
    pub payload: serde_json::Value,
    pub metadata: BTreeMap<String, String>,
}

impl Message {
    /// The event's name as the metadata carries it; the topic when it does not.
    pub fn event_name(&self) -> &str {
        self.metadata.get(METADATA_EVENT_NAME).map(String::as_str).unwrap_or(&self.topic)
    }
}

#[derive(Debug, thiserror::Error)]
#[error("bus: {0}")]
pub struct BusError(pub String);

pub type HandlerFuture = Pin<Box<dyn Future<Output = Result<(), BusError>> + Send>>;
pub type Handler = Arc<dyn Fn(Message) -> HandlerFuture + Send + Sync>;

pub trait Bus: Send + Sync {
    /// What a span says the message went over: `outbox` in process, `nats` over the wire.
    fn system(&self) -> &'static str;
    fn publish(&self, message: Message) -> impl Future<Output = Result<(), BusError>> + Send;
    /// Subscribes to one event on one subject. A subject carries every event
    /// of an aggregate; the bus hands the handler the one it asked for and
    /// acknowledges the rest unread, so a consume span is opened only for
    /// what was consumed.
    fn subscribe(&self, topic: &str, event: &str, handler: Handler) -> impl Future<Output = Result<(), BusError>> + Send;
    fn close(&self) -> impl Future<Output = ()> + Send;
}

/// Runs one handler under the consumer span of its message: the hop off the
/// bus is in the trace whichever bus it came off.
pub async fn deliver(system: &'static str, message: Message, handler: &Handler) -> Result<(), BusError> {
    let span = tracing::consume_span(system, &message.topic, message.event_name(), &message.metadata);
    ::tracing::Instrument::instrument(handler(message), span).await
}

/// The one the assembly picked.
pub enum AnyBus {
    Nats(Box<nats::NatsBus>),
    InProc(inproc::InProcBus),
}

impl Bus for AnyBus {
    fn system(&self) -> &'static str {
        match self {
            AnyBus::Nats(b) => b.system(),
            AnyBus::InProc(b) => b.system(),
        }
    }
    async fn publish(&self, message: Message) -> Result<(), BusError> {
        match self {
            AnyBus::Nats(b) => b.publish(message).await,
            AnyBus::InProc(b) => b.publish(message).await,
        }
    }
    async fn subscribe(&self, topic: &str, event: &str, handler: Handler) -> Result<(), BusError> {
        match self {
            AnyBus::Nats(b) => b.subscribe(topic, event, handler).await,
            AnyBus::InProc(b) => b.subscribe(topic, event, handler).await,
        }
    }
    async fn close(&self) {
        match self {
            AnyBus::Nats(b) => b.close().await,
            AnyBus::InProc(b) => b.close().await,
        }
    }
}
