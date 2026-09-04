use super::Event;

/// The payment is authorised and the order may be fulfilled.
pub struct OrderConfirmed {
    pub order_id: String,
    pub authorization: String,
}

impl OrderConfirmed {
    pub const NAME: &'static str = "oms.OrderConfirmed";
}

impl Event for OrderConfirmed {
    fn name(&self) -> &'static str {
        Self::NAME
    }
}
