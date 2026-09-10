use std::future::Future;

use crate::domain::order::port::Orders;
use crate::domain::order::vo::Money;
use crate::domain::order::{Error, Status};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeclineReason {
    CardRefused,
    OrderCancelled,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Authorization {
    Authorized { payment_id: String },
    Declined(DeclineReason),
}

/// Ledger's outcome in this use case's vocabulary. A transport failure is
/// an error, never a decline. One logical checkout uses one stable payment id.
pub trait Payments: Send + Sync {
    fn authorize(&self, payment_id: &str, order_id: &str, total: &Money) -> impl Future<Output = Result<Authorization, Error>> + Send;
}

pub struct UseCase<O: Orders, P: Payments> {
    orders: O,
    payments: P,
}

impl<O: Orders, P: Payments> UseCase<O, P> {
    pub fn new(orders: O, payments: P) -> Self {
        Self { orders, payments }
    }

    /// OrderPlaced is durable before this runs. Retrying after a lost reply
    /// reuses the order id as payment id; confirmed/cancelled orders need no call.
    pub async fn handle(&self, order_id: &str) -> Result<Option<(Authorization, Money)>, Error> {
        let order = self.orders.by_id(order_id).await?;
        if order.status != Status::Placed {
            return Ok(None);
        }
        let outcome = self.payments.authorize(&order.id, &order.id, &order.total).await?;
        Ok(Some((outcome, order.total)))
    }
}
