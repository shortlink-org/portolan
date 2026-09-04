mod order_cancelled;
mod order_confirmed;
mod order_placed;

pub use order_cancelled::OrderCancelled;
pub use order_confirmed::OrderConfirmed;
pub use order_placed::OrderPlaced;

/// What every event of the aggregate can say about itself: its name on the bus.
pub trait Event {
    fn name(&self) -> &'static str;
}
