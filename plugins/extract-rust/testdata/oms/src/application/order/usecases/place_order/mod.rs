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
}

impl<O: Orders> UseCase<O> {
    pub fn new(orders: O) -> Self {
        UseCase { orders }
    }

    pub async fn handle(&self, input: Input) -> Result<String, Error> {
        let existing = self.orders.by_basket(&input.basket_id).await?;
        if existing.is_some() {
            return Ok(String::new());
        }
        let (order, placed) = Order::place(input.order_id, input.customer_id, input.basket_id, input.lines, input.total)?;
        self.orders.save(&order, &[&placed]).await?;
        Ok(order.id)
    }
}
