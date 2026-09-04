use chrono::{DateTime, Utc};
use serde::Serialize;

use super::Event;

/// The payment is authorised and the order may be fulfilled. Whoever ships
/// listens for this.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderConfirmed {
    pub order_id: String,
    pub authorization_id: String,
    pub occurred_at: DateTime<Utc>,
}

impl Event for OrderConfirmed {
    fn name(&self) -> &'static str {
        "oms.OrderConfirmed"
    }
    fn payload(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or_default()
    }
    fn occurred_at(&self) -> DateTime<Utc> {
        self.occurred_at
    }
}
