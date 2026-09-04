use std::future::Future;

use super::Clock;
use crate::domain::order::Error;
use crate::domain::order::port::Orders;
use crate::domain::order::vo::Money;

/// Somebody who can hold the order's total against the customer's instrument.
/// Declared here, by the one use case that needs it, and filled by an adapter
/// over the ledger's contract - or by a stand-in while there is no ledger.
pub trait Payments: Send + Sync {
    fn authorize(&self, order_id: &str, total: &Money) -> impl Future<Output = Result<String, Error>> + Send;
}

pub struct Input {
    pub order_id: String,
}

pub struct UseCase<O: Orders, P: Payments> {
    orders: O,
    payments: P,
    clock: Clock,
}

impl<O: Orders, P: Payments> UseCase<O, P> {
    pub fn new(orders: O, payments: P, clock: Clock) -> Self {
        UseCase { orders, payments, clock }
    }

    pub async fn handle(&self, input: Input) -> Result<(), Error> {
        let mut order = self.orders.by_id(&input.order_id).await?;
        let authorization_id = self.payments.authorize(&order.id, &order.total).await?;
        let confirmed = order.confirm(authorization_id, (self.clock)())?;
        self.orders.save(&order, &[&confirmed]).await?;
        Ok(())
    }
}
