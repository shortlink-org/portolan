//! The cart's events, as this service reads them off the bus: the fields it
//! needs and nothing else. The cart names the event and the subject; the
//! shape is its `toWire`, and a field it stops sending is a decode error here,
//! not a silent zero.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::domain::order::vo::Money;

/// The subject the cart publishes on, and the name it gives the checkout.
pub const TOPIC: &str = "shop.cart.basket";
pub const BASKET_CHECKED_OUT: &str = "cart.BasketCheckedOut";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub sku: String,
    pub quantity: u32,
    pub unit_price: Money,
}

/// A basket was checked out: frozen, priced, and waiting for an order.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BasketCheckedOut {
    pub basket_id: String,
    pub customer_id: String,
    pub items: Vec<Item>,
    pub total: Money,
    pub quote_id: String,
    pub occurred_at: DateTime<Utc>,
}

impl BasketCheckedOut {
    pub fn decode(payload: &serde_json::Value) -> Result<BasketCheckedOut, serde_json::Error> {
        serde_json::from_value(payload.clone())
    }
}
