use std::sync::Arc;

use crate::application::order::usecases::request_payment::{Authorization, Payments};
use crate::application::order::usecases::{Clock, confirm_order, request_payment};
use crate::domain::order::Error;
use crate::domain::order::port::Orders;
use crate::pkg::messaging::Message;

pub const ORDER_PLACED: &str = "oms.OrderPlaced";

/// The stored OrderPlaced triggers the RPC. Confirming from its answer also
/// recovers a ledger save whose subsequent event publication failed.
pub struct RequestPaymentOnOrderPlaced<O: Orders, P: Payments> {
    request: Arc<request_payment::UseCase<O, P>>,
    confirm: Arc<confirm_order::UseCase<O>>,
    clock: Clock,
}
impl<O: Orders, P: Payments> RequestPaymentOnOrderPlaced<O, P> {
    pub fn new(request: Arc<request_payment::UseCase<O, P>>, confirm: Arc<confirm_order::UseCase<O>>, clock: Clock) -> Self {
        Self { request, confirm, clock }
    }
    pub async fn handle(&self, message: &Message) -> Result<(), Error> {
        if message.event_name() != ORDER_PLACED {
            return Ok(());
        }
        let order_id = message.payload["orderId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| Error::Payment("OrderPlaced has no orderId".into()))?;
        if let Some((Authorization::Authorized { payment_id }, amount)) = self.request.handle(order_id).await? {
            self.confirm
                .handle(confirm_order::Input {
                    order_id: order_id.into(),
                    payment_id,
                    amount,
                    authorized_at: (self.clock)(),
                })
                .await?;
        }
        // A confirmed decline is an answer, not a retryable outage. The order
        // remains placed, awaiting an explicit cancellation/new payment decision.
        Ok(())
    }
}
