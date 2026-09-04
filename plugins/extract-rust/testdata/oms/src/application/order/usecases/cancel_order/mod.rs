use crate::domain::order::port::Orders;
use crate::domain::order::{Error, Status};

pub struct Input {
    pub order_id: String,
    pub reason: String,
}

/// Cancels an order that has not been dispatched; cancelling twice changes nothing.
pub struct UseCase<O: Orders> {
    orders: O,
}

impl<O: Orders> UseCase<O> {
    pub async fn handle(&self, input: Input) -> Result<(), Error> {
        let mut order = self.orders.by_id(&input.order_id).await?;
        match order.status {
            Status::Cancelled => return Ok(()),
            _ => {
                let cancelled = order.cancel(input.reason)?;
                self.orders.save(&order, &[&cancelled]).await?;
            }
        }
        Ok(())
    }
}
