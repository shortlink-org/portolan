use std::sync::Arc;

use crate::application::order::usecases::confirm_order::{Input, UseCase as ConfirmOrder};
use crate::domain::order::Error;
use crate::infrastructure::payments::client::PaymentsClient;
use crate::infrastructure::repository::order::PostgresOrders;

/// A message off the bus: its name, and the payload as JSON.
pub struct Message {
    pub name: String,
    pub payload: serde_json::Value,
}

/// Confirms the order once the payment for it is authorised.
pub struct ConfirmOrderOnPaymentAuthorized {
    confirm_order: Arc<ConfirmOrder<PostgresOrders, PaymentsClient>>,
}

impl ConfirmOrderOnPaymentAuthorized {
    pub async fn handle(&self, message: &Message) -> Result<(), Error> {
        if message.name != "payments.PaymentAuthorized" {
            return Ok(());
        }
        let order_id = message.payload["orderId"].as_str().unwrap_or_default().to_string();
        self.confirm_order.handle(Input { order_id }).await?;
        Ok(())
    }
}
