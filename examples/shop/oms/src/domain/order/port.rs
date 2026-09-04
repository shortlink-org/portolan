//! What a use case needs from outside the domain: somewhere orders are kept.
//! Declared here, filled by an adapter under infrastructure/, and the futures
//! are Send because a use case runs wherever tonic puts it.

use std::future::Future;

use super::event::Event;
use super::{Error, Order};

pub trait Orders: Send + Sync {
    fn by_id(&self, id: &str) -> impl Future<Output = Result<Order, Error>> + Send;
    /// The order placed from a basket, if one was: what makes placing idempotent.
    fn by_basket(&self, basket_id: &str) -> impl Future<Output = Result<Option<Order>, Error>> + Send;
    /// Writes the order and its events in one transaction, or neither.
    fn save(&self, order: &Order, events: &[&dyn Event]) -> impl Future<Output = Result<(), Error>> + Send;
}

// A store behind a reference or an Arc is the same store: what a test hands
// in by reference, and what the assembly shares between use cases.
impl<T: Orders + ?Sized> Orders for &T {
    fn by_id(&self, id: &str) -> impl Future<Output = Result<Order, Error>> + Send {
        (**self).by_id(id)
    }
    fn by_basket(&self, basket_id: &str) -> impl Future<Output = Result<Option<Order>, Error>> + Send {
        (**self).by_basket(basket_id)
    }
    fn save(&self, order: &Order, events: &[&dyn Event]) -> impl Future<Output = Result<(), Error>> + Send {
        (**self).save(order, events)
    }
}

impl<T: Orders + ?Sized> Orders for std::sync::Arc<T> {
    fn by_id(&self, id: &str) -> impl Future<Output = Result<Order, Error>> + Send {
        (**self).by_id(id)
    }
    fn by_basket(&self, basket_id: &str) -> impl Future<Output = Result<Option<Order>, Error>> + Send {
        (**self).by_basket(basket_id)
    }
    fn save(&self, order: &Order, events: &[&dyn Event]) -> impl Future<Output = Result<(), Error>> + Send {
        (**self).save(order, events)
    }
}
