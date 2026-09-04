use chrono::{DateTime, Utc};
use serde::Serialize;

use super::Event;
use crate::domain::order::vo::Money;

/// An order came into being from a checked-out basket. Placed, not yet paid
/// for: whoever moves money listens for this.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderPlaced {
    pub order_id: String,
    pub basket_id: String,
    pub customer_id: String,
    pub total: Money,
    pub occurred_at: DateTime<Utc>,
}

impl Event for OrderPlaced {
    fn name(&self) -> &'static str {
        "oms.OrderPlaced"
    }
    fn payload(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or_default()
    }
    fn occurred_at(&self) -> DateTime<Utc> {
        self.occurred_at
    }
}
