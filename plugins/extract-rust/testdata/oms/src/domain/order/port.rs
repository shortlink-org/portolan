use std::future::Future;

use super::event::Event;
use super::{Error, Order};

pub trait Orders: Send + Sync {
    fn by_id(&self, id: &str) -> impl Future<Output = Result<Order, Error>> + Send;
    /// The order placed from a basket, if one was.
    fn by_basket(&self, basket_id: &str) -> impl Future<Output = Result<Option<Order>, Error>> + Send;
    fn save(&self, order: &Order, events: &[&dyn Event]) -> impl Future<Output = Result<(), Error>> + Send;
}
