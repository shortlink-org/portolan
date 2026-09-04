use super::Event;

/// The order will not be fulfilled.
pub struct OrderCancelled {
    pub order_id: String,
    pub reason: String,
}

impl Event for OrderCancelled {
    fn name(&self) -> &'static str {
        "oms.OrderCancelled"
    }
}
