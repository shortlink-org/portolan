use std::sync::Arc;

use crate::application::order::usecases::cancel_order::{Input, UseCase as CancelOrder};
use crate::domain::order::Error;
use crate::domain::order::port::Orders;
use crate::infrastructure::ledger::PaymentDeclined;

/// Cancels the order whose payment ledger declined (ADR oms.0007). The same
/// fact heard twice, or after the RPC answer already cancelled, changes nothing.
pub struct CancelOrderOnPaymentDeclined<O: Orders> {
    cancel_order: Arc<CancelOrder<O>>,
}
impl<O: Orders> CancelOrderOnPaymentDeclined<O> {
    pub fn new(cancel_order: Arc<CancelOrder<O>>) -> Self {
        Self { cancel_order }
    }
    pub async fn handle(&self, event: &PaymentDeclined) -> Result<(), Error> {
        self.cancel_order
            .handle(Input::payment_declined(event.order_id.clone(), event.payment_id.clone(), event.reason.as_str()))
            .await
    }
}
