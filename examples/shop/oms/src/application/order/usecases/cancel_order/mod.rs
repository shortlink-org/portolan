use super::Clock;
use crate::domain::order::port::Orders;
use crate::domain::order::{Error, Status};

pub struct Input {
    pub order_id: String,
    pub reason: String,
    /// Set when a declined payment cancels (ADR oms.0007): only a placed order
    /// paid under this id is cancelled, and a confirmed one stays confirmed.
    pub declined_payment_id: Option<String>,
}

impl Input {
    /// The cancellation a decline asks for, its reason naming ledger's.
    pub fn payment_declined(order_id: String, payment_id: String, reason: &str) -> Input {
        Input {
            order_id,
            reason: format!("payment declined: {reason}"),
            declined_payment_id: Some(payment_id),
        }
    }
}

pub struct UseCase<O: Orders> {
    orders: O,
    clock: Clock,
}

impl<O: Orders> UseCase<O> {
    pub fn new(orders: O, clock: Clock) -> Self {
        UseCase { orders, clock }
    }

    pub async fn handle(&self, input: Input) -> Result<(), Error> {
        let mut order = self.orders.by_id(&input.order_id).await?;
        if let Some(payment_id) = &input.declined_payment_id {
            if *payment_id != order.id {
                return Err(Error::Payment("decline does not match the checkout".into()));
            }
            // A late decline must not undo a confirmation; a repeated one finds
            // the order cancelled already.
            if order.status != Status::Placed {
                return Ok(());
            }
        }
        match order.status {
            Status::Cancelled => return Ok(()),
            _ => {
                let cancelled = order.cancel(input.reason, (self.clock)())?;
                self.orders.save(&order, &[&cancelled]).await?;
            }
        }
        Ok(())
    }
}
