use std::collections::HashMap;
use std::sync::Mutex;

use super::{Bus, BusError, Handler, Message, deliver};

/// Delivers to subscribers in the publishing call. A subscriber's failure is
/// the publisher's, which is what lets the relay leave the row unpublished and
/// try again.
#[derive(Default)]
pub struct InProcBus {
    /// Subject → the events subscribed to on it, each with its handler.
    handlers: Mutex<HashMap<String, Vec<(String, Handler)>>>,
}

impl Bus for InProcBus {
    fn system(&self) -> &'static str {
        "outbox"
    }

    async fn publish(&self, message: Message) -> Result<(), BusError> {
        let handlers: Vec<(String, Handler)> = self
            .handlers
            .lock()
            .map(|h| h.get(&message.topic).cloned().unwrap_or_default())
            .unwrap_or_default();
        for (event, handler) in &handlers {
            if message.event_name() == event {
                deliver(self.system(), message.clone(), handler).await?;
            }
        }
        Ok(())
    }

    async fn subscribe(&self, topic: &str, event: &str, handler: Handler) -> Result<(), BusError> {
        if let Ok(mut handlers) = self.handlers.lock() {
            handlers.entry(topic.to_string()).or_default().push((event.to_string(), handler));
        }
        Ok(())
    }

    async fn close(&self) {}
}
