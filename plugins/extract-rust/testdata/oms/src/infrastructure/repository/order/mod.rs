use crate::domain::order::event::Event;
use crate::domain::order::port::Orders;
use crate::domain::order::{Error, Order};

/// One subject per aggregate, dotted the way a NATS subject is.
pub const TOPIC: &str = "shop.oms.order";

pub struct PostgresOrders;

impl Orders for PostgresOrders {
    async fn by_id(&self, _id: &str) -> Result<Order, Error> {
        Err(Error::Empty)
    }

    async fn by_basket(&self, _basket_id: &str) -> Result<Option<Order>, Error> {
        Ok(None)
    }

    async fn save(&self, _order: &Order, _events: &[&dyn Event]) -> Result<(), Error> {
        Ok(())
    }
}
