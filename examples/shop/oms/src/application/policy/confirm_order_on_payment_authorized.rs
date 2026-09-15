use std::sync::Arc;

use crate::application::order::usecases::confirm_order::{Input, UseCase as ConfirmOrder};
use crate::domain::order::Error;
use crate::domain::order::port::Orders;
use crate::infrastructure::ledger::PaymentAuthorized;

/// Applies the ledger's public fact; it never calls Authorize.
pub struct ConfirmOrderOnPaymentAuthorized<O: Orders> {
    confirm_order: Arc<ConfirmOrder<O>>,
}
impl<O: Orders> ConfirmOrderOnPaymentAuthorized<O> {
    pub fn new(confirm_order: Arc<ConfirmOrder<O>>) -> Self {
        Self { confirm_order }
    }
    pub async fn handle(&self, event: &PaymentAuthorized) -> Result<(), Error> {
        self.confirm_order
            .handle(Input {
                order_id: event.order_id.clone(),
                payment_id: event.payment_id.clone(),
                amount: event.amount.clone(),
                authorized_at: event.occurred_at,
            })
            .await
    }
}
