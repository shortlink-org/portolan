use std::sync::Arc;

use crate::application::order::usecases::confirm_order::{Input, Payments, UseCase as ConfirmOrder};
use crate::domain::order::Error;
use crate::domain::order::port::Orders;
use crate::pkg::messaging::Message;

/// Confirms the order once the payment for it is authorised (ADR oms.0005).
/// Declared ahead of its publisher: nothing in the estate says
/// `payments.PaymentAuthorized` yet, and the catalog says so.
pub struct ConfirmOrderOnPaymentAuthorized<O: Orders, P: Payments> {
    confirm_order: Arc<ConfirmOrder<O, P>>,
}

impl<O: Orders, P: Payments> ConfirmOrderOnPaymentAuthorized<O, P> {
    pub fn new(confirm_order: Arc<ConfirmOrder<O, P>>) -> Self {
        ConfirmOrderOnPaymentAuthorized { confirm_order }
    }

    pub async fn handle(&self, message: &Message) -> Result<(), Error> {
        // The name the ledger will give the event, when there is a ledger:
        // spelled out here, because the name is the claim the catalog reads.
        if message.event_name() != "payments.PaymentAuthorized" {
            return Ok(());
        }
        let order_id = message.payload["orderId"].as_str().unwrap_or_default().to_string();
        self.confirm_order.handle(Input { order_id }).await?;
        Ok(())
    }
}
