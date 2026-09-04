use super::event::Event;
use super::{Error, Order};

pub trait Orders {
    async fn by_id(&self, id: &str) -> Result<Order, Error>;
    /// The order placed from a basket, if one was.
    async fn by_basket(&self, basket_id: &str) -> Result<Option<Order>, Error>;
    async fn save(&self, order: &Order, events: &[&dyn Event]) -> Result<(), Error>;
}
