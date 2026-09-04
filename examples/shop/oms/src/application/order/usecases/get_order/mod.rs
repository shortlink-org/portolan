use crate::domain::order::port::Orders;
use crate::domain::order::{Error, Order};

pub struct UseCase<O: Orders> {
    orders: O,
}

impl<O: Orders> UseCase<O> {
    pub fn new(orders: O) -> Self {
        UseCase { orders }
    }

    pub async fn handle(&self, id: &str) -> Result<Order, Error> {
        self.orders.by_id(id).await
    }
}
