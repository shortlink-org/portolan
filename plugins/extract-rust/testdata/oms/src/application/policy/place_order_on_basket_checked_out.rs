use std::sync::Arc;

use crate::application::order::usecases::place_order::{Input, UseCase as PlaceOrder};
use crate::domain::order::Error;
use crate::infrastructure::cart::BasketCheckedOut;
use crate::infrastructure::repository::order::PostgresOrders;

/// Places the order the basket was checked out for.
pub struct PlaceOrderOnBasketCheckedOut {
    place_order: Arc<PlaceOrder<PostgresOrders>>,
}

impl PlaceOrderOnBasketCheckedOut {
    pub async fn handle(&self, event: &BasketCheckedOut) -> Result<(), Error> {
        self.place_order
            .handle(Input { order_id: event.basket_id.clone(), customer_id: event.customer_id.clone(), basket_id: event.basket_id.clone(), lines: vec![], total: event.total.clone() })
            .await?;
        Ok(())
    }
}
