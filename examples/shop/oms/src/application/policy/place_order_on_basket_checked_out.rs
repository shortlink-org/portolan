use std::sync::Arc;

use crate::application::order::usecases::place_order::{Input, UseCase as PlaceOrder};
use crate::domain::order::port::Orders;
use crate::domain::order::{Error, Line};
use crate::infrastructure::cart::BasketCheckedOut;

/// Places the order the basket was checked out for (ADR oms.0002). The order
/// takes the basket's id, so the same checkout heard twice places one order.
pub struct PlaceOrderOnBasketCheckedOut<O: Orders> {
    place_order: Arc<PlaceOrder<O>>,
}

impl<O: Orders> PlaceOrderOnBasketCheckedOut<O> {
    pub fn new(place_order: Arc<PlaceOrder<O>>) -> Self {
        PlaceOrderOnBasketCheckedOut { place_order }
    }

    pub async fn handle(&self, event: &BasketCheckedOut) -> Result<(), Error> {
        let lines = event
            .items
            .iter()
            .map(|i| Line {
                sku: i.sku.clone(),
                quantity: i.quantity,
                unit_price: i.unit_price.clone(),
            })
            .collect();
        self.place_order
            .handle(Input {
                order_id: event.basket_id.clone(),
                customer_id: event.customer_id.clone(),
                basket_id: event.basket_id.clone(),
                lines,
                total: event.total.clone(),
            })
            .await?;
        Ok(())
    }
}
