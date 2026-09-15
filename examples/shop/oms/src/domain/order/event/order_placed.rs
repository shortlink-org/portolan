use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::Event;
use crate::domain::order::vo::Money;

/// An order came into being from a checked-out basket. Placed, not yet paid
/// for: whoever moves money listens for this. This service reads it back off
/// the bus too, to ask for that money itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderPlaced {
    pub order_id: String,
    pub basket_id: String,
    pub customer_id: String,
    pub total: Money,
    pub occurred_at: DateTime<Utc>,
}

impl OrderPlaced {
    pub const NAME: &str = "oms.OrderPlaced";

    pub fn decode(payload: &serde_json::Value) -> Result<OrderPlaced, serde_json::Error> {
        serde_json::from_value(payload.clone())
    }
}

impl Event for OrderPlaced {
    fn name(&self) -> &'static str {
        OrderPlaced::NAME
    }
    fn payload(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or_default()
    }
    fn occurred_at(&self) -> DateTime<Utc> {
        self.occurred_at
    }
}
