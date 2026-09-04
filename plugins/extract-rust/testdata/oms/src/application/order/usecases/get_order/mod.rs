use std::sync::Arc;

use crate::domain::order::port::Orders;
use crate::domain::order::{Error, Order};

/// Answers with the order as it is now.
pub struct UseCase {
    orders: Arc<dyn Orders>,
}

impl UseCase {
    pub async fn handle(&self, id: &str) -> Result<Order, Error> {
        self.orders.by_id(id).await
    }
}
