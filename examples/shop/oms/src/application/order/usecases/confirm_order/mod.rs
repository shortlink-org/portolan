use chrono::{DateTime, Utc};

use crate::domain::order::port::Orders;
use crate::domain::order::vo::Money;
use crate::domain::order::{Error, Status};

pub struct Input {
    pub order_id: String,
    pub payment_id: String,
    pub amount: Money,
    pub authorized_at: DateTime<Utc>,
}

/// Applies an authorization fact. It has no payment port and cannot authorize
/// again. Both the RPC answer and ledger event reach this idempotent operation.
pub struct UseCase<O: Orders> {
    orders: O,
}

impl<O: Orders> UseCase<O> {
    pub fn new(orders: O) -> Self {
        Self { orders }
    }

    pub async fn handle(&self, input: Input) -> Result<(), Error> {
        let mut order = self.orders.by_id(&input.order_id).await?;
        if input.payment_id != order.id || input.amount != order.total {
            return Err(Error::Payment("authorization does not match the checkout".into()));
        }
        // A late authorization must never resurrect a cancelled order. Repeated
        // RPC/event delivery must not emit a second OrderConfirmed either.
        if order.status != Status::Placed {
            return Ok(());
        }
        // authorizationId is retained on the existing event for compatibility;
        // it carries the public ledger payment id, never the gateway's handle.
        let confirmed = order.confirm(input.payment_id, input.authorized_at)?;
        self.orders.save(&order, &[&confirmed]).await
    }
}
