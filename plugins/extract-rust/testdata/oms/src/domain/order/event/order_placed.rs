use super::Event;
use crate::domain::order::vo::Money;

/// An order came into being from a checked-out basket.
pub struct OrderPlaced {
    pub order_id: String,
    pub basket_id: String,
    pub total: Money,
}

impl Event for OrderPlaced {
    fn name(&self) -> &'static str {
        "oms.OrderPlaced"
    }
}
