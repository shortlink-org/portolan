use super::Clock;
use crate::domain::order::port::Orders;
use crate::domain::order::{Error, Status};

pub struct Input {
    pub order_id: String,
    pub reason: String,
}

pub struct UseCase<O: Orders> {
    orders: O,
    clock: Clock,
}

impl<O: Orders> UseCase<O> {
    pub fn new(orders: O, clock: Clock) -> Self {
        UseCase { orders, clock }
    }

    pub async fn handle(&self, input: Input) -> Result<(), Error> {
        let mut order = self.orders.by_id(&input.order_id).await?;
        match order.status {
            Status::Cancelled => return Ok(()),
            _ => {
                let cancelled = order.cancel(input.reason, (self.clock)())?;
                self.orders.save(&order, &[&cancelled]).await?;
            }
        }
        Ok(())
    }
}
