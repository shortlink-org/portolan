//! What more than one test file needs: an in-memory store that records what
//! it publishes, and a clock that does not move. Each file under tests/ is its
//! own crate and uses only part of this.
#![allow(dead_code)]

use std::sync::Mutex;

use chrono::{DateTime, TimeZone, Utc};
use oms::application::order::usecases::Clock;
use oms::domain::order::event::Event;
use oms::domain::order::port::Orders;
use oms::domain::order::{Error, Order};

#[derive(Default)]
pub struct Memory {
    pub orders: Mutex<Vec<Order>>,
    pub published: Mutex<Vec<String>>,
    pub payloads: Mutex<Vec<serde_json::Value>>,
}

impl Orders for Memory {
    async fn by_id(&self, id: &str) -> Result<Order, Error> {
        self.orders
            .lock()
            .unwrap()
            .iter()
            .find(|o| o.id == id)
            .cloned()
            .ok_or_else(|| Error::NotFound(id.into()))
    }
    async fn by_basket(&self, basket_id: &str) -> Result<Option<Order>, Error> {
        Ok(self.orders.lock().unwrap().iter().find(|o| o.basket_id == basket_id).cloned())
    }
    async fn save(&self, order: &Order, events: &[&dyn Event]) -> Result<(), Error> {
        let mut orders = self.orders.lock().unwrap();
        if let Some(current) = orders.iter().find(|o| o.id == order.id) {
            if current.version != order.version {
                return Err(Error::Conflict);
            }
        } else if order.version != 0 {
            return Err(Error::Conflict);
        }
        orders.retain(|o| o.id != order.id);
        orders.push(Order {
            version: order.version + 1,
            ..order.clone()
        });
        self.published.lock().unwrap().extend(events.iter().map(|e| e.name().to_string()));
        self.payloads.lock().unwrap().extend(events.iter().map(|e| e.payload()));
        Ok(())
    }
}

pub fn fixed() -> Clock {
    Box::new(|| Utc.with_ymd_and_hms(2026, 9, 5, 12, 0, 0).unwrap())
}

pub fn now() -> DateTime<Utc> {
    fixed()()
}
