//! What the aggregate says happened. Each event names itself on the bus and
//! renders its own payload; the adapter that writes the outbox asks for both.

mod order_cancelled;
mod order_confirmed;
mod order_placed;

pub use order_cancelled::OrderCancelled;
pub use order_confirmed::OrderConfirmed;
pub use order_placed::OrderPlaced;

/// What every event of the aggregate can say about itself: its name on the
/// bus, and what it looks like on the wire.
pub trait Event: Send + Sync {
    fn name(&self) -> &'static str;
    fn payload(&self) -> serde_json::Value;
    fn occurred_at(&self) -> chrono::DateTime<chrono::Utc>;
}
