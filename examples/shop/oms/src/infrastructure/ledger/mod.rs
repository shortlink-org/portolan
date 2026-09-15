//! The ledger's events, as this service reads them off the bus: the fields it
//! needs and nothing else. Ledger names the events and the subject; a field it
//! stops sending, or a decline reason outside its closed set, is a decode error
//! here, not a silent default. The RPC answer is the other way the same facts
//! arrive; that adapter is `payments`.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::application::order::usecases::request_payment::DeclineReason;
use crate::domain::order::vo::Money;

/// Ledger-owned integration contract, distinct from its private gateway handle.
pub const TOPIC: &str = "payments.ledger.payment";
pub const PAYMENT_AUTHORIZED: &str = "ledger.PaymentAuthorized";
pub const PAYMENT_DECLINED: &str = "ledger.PaymentDeclined";

/// The money for the order is held.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAuthorized {
    pub payment_id: String,
    pub order_id: String,
    pub amount: Money,
    pub occurred_at: DateTime<Utc>,
}

impl PaymentAuthorized {
    pub fn decode(payload: &serde_json::Value) -> Result<PaymentAuthorized, serde_json::Error> {
        serde_json::from_value(payload.clone())
    }
}

/// The money was not held, for one of ledger's closed reasons.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentDeclined {
    pub payment_id: String,
    pub order_id: String,
    pub reason: DeclineReason,
    pub occurred_at: DateTime<Utc>,
}

impl PaymentDeclined {
    pub fn decode(payload: &serde_json::Value) -> Result<PaymentDeclined, serde_json::Error> {
        serde_json::from_value(payload.clone())
    }
}
