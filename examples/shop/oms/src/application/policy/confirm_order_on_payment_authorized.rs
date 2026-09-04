use std::sync::Arc;

use crate::application::order::usecases::confirm_order::{Input, Payments, UseCase as ConfirmOrder};
use crate::domain::order::Error;
use crate::domain::order::port::Orders;
use crate::pkg::messaging::Message;

/// Confirms the order once the payment for it is authorised (ADR oms.0005).
/// The publisher is `payments.ledger`, and the name is the one it puts on the
/// message: every service on this bus names its events after itself.
pub struct ConfirmOrderOnPaymentAuthorized<O: Orders, P: Payments> {
    confirm_order: Arc<ConfirmOrder<O, P>>,
}

impl<O: Orders, P: Payments> ConfirmOrderOnPaymentAuthorized<O, P> {
    pub fn new(confirm_order: Arc<ConfirmOrder<O, P>>) -> Self {
        ConfirmOrderOnPaymentAuthorized { confirm_order }
    }

    pub async fn handle(&self, message: &Message) -> Result<(), Error> {
        // The name the ledger puts on the message, spelled out here because
        // the name is the claim the catalog reads.
        if message.event_name() != "ledger.PaymentAuthorized" {
            return Ok(());
        }
        let order_id = message.payload["orderId"].as_str().unwrap_or_default().to_string();
        self.confirm_order.handle(Input { order_id }).await?;
        Ok(())
    }
}
