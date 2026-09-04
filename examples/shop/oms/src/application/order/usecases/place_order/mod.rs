use super::Clock;
use crate::domain::order::port::Orders;
use crate::domain::order::vo::Money;
use crate::domain::order::{Error, Line, Order};

pub struct Input {
    pub order_id: String,
    pub customer_id: String,
    pub basket_id: String,
    pub lines: Vec<Line>,
    pub total: Money,
}

pub struct UseCase<O: Orders> {
    orders: O,
    clock: Clock,
}

impl<O: Orders> UseCase<O> {
    pub fn new(orders: O, clock: Clock) -> Self {
        UseCase { orders, clock }
    }

    /// Answers with the id of the order placed, or of the one already placed
    /// from this basket.
    pub async fn handle(&self, input: Input) -> Result<String, Error> {
        if let Some(existing) = self.orders.by_basket(&input.basket_id).await? {
            return Ok(existing.id);
        }
        let (order, placed) = Order::place(input.order_id, input.customer_id, input.basket_id, input.lines, input.total, (self.clock)())?;
        self.orders.save(&order, &[&placed]).await?;
        Ok(order.id)
    }
}
