use chrono::{DateTime, Utc};
use serde::Serialize;

use super::Event;

/// The order will not be fulfilled. The reason says whether the customer
/// asked or the payment was declined, because a consumer unwinds them
/// differently: a hold is voided, a capture is refunded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderCancelled {
    pub order_id: String,
    pub reason: String,
    pub occurred_at: DateTime<Utc>,
}

impl Event for OrderCancelled {
    fn name(&self) -> &'static str {
        "oms.OrderCancelled"
    }
    fn payload(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or_default()
    }
    fn occurred_at(&self) -> DateTime<Utc> {
        self.occurred_at
    }
}
