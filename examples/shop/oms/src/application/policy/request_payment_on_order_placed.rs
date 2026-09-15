use std::sync::Arc;

use crate::application::order::usecases::Clock;
use crate::application::order::usecases::cancel_order::{Input as Cancellation, UseCase as CancelOrder};
use crate::application::order::usecases::confirm_order::{Input as Confirmation, UseCase as ConfirmOrder};
use crate::application::order::usecases::request_payment::{Authorization, Payments, UseCase as RequestPayment};
use crate::domain::order::Error;
use crate::domain::order::event::OrderPlaced;
use crate::domain::order::port::Orders;

/// The stored OrderPlaced triggers the RPC. Applying its answer also recovers
/// a ledger save whose subsequent event publication failed.
pub struct RequestPaymentOnOrderPlaced<O: Orders, P: Payments> {
    request: Arc<RequestPayment<O, P>>,
    confirm: Arc<ConfirmOrder<O>>,
    cancel: Arc<CancelOrder<O>>,
    clock: Clock,
}
impl<O: Orders, P: Payments> RequestPaymentOnOrderPlaced<O, P> {
    pub fn new(request: Arc<RequestPayment<O, P>>, confirm: Arc<ConfirmOrder<O>>, cancel: Arc<CancelOrder<O>>, clock: Clock) -> Self {
        Self {
            request,
            confirm,
            cancel,
            clock,
        }
    }
    pub async fn handle(&self, event: &OrderPlaced) -> Result<(), Error> {
        match self.request.handle(&event.order_id).await? {
            Some((Authorization::Authorized { payment_id }, amount)) => {
                self.confirm
                    .handle(Confirmation {
                        order_id: event.order_id.clone(),
                        payment_id,
                        amount,
                        authorized_at: (self.clock)(),
                    })
                    .await?;
            }
            // A confirmed decline is an answer, not a retryable outage, and it
            // cancels the order (ADR oms.0007). The payment id is the order id.
            Some((Authorization::Declined(reason), _)) => {
                self.cancel
                    .handle(Cancellation::payment_declined(event.order_id.clone(), event.order_id.clone(), reason.as_str()))
                    .await?;
            }
            None => {}
        }
        Ok(())
    }
}
