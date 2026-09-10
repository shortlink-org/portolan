use std::sync::Arc;

use crate::application::order::usecases::confirm_order::{Input, UseCase as ConfirmOrder};
use crate::domain::order::Error;
use crate::domain::order::port::Orders;
use crate::infrastructure::payments::{PAYMENT_AUTHORIZED, PaymentAuthorized};
use crate::pkg::messaging::Message;

/// Applies the ledger's public fact; it never calls Authorize.
pub struct ConfirmOrderOnPaymentAuthorized<O: Orders> {
    confirm_order: Arc<ConfirmOrder<O>>,
}
impl<O: Orders> ConfirmOrderOnPaymentAuthorized<O> {
    pub fn new(confirm_order: Arc<ConfirmOrder<O>>) -> Self {
        Self { confirm_order }
    }
    pub async fn handle(&self, message: &Message) -> Result<(), Error> {
        if message.event_name() != PAYMENT_AUTHORIZED {
            return Ok(());
        }
        let event: PaymentAuthorized =
            serde_json::from_value(message.payload.clone()).map_err(|e| Error::Payment(format!("decoding PaymentAuthorized: {e}")))?;
        self.confirm_order
            .handle(Input {
                order_id: event.order_id,
                payment_id: event.payment_id,
                amount: event.amount,
                authorized_at: event.occurred_at,
            })
            .await
    }
}
