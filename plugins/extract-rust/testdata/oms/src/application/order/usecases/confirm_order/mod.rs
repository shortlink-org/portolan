use crate::domain::order::port::Orders;
use crate::domain::order::vo::Money;
use crate::domain::order::Error;

/// Somebody who can authorise a payment for an order.
pub trait Payments {
    async fn authorize(&self, order_id: &str, total: &Money) -> Result<String, Error>;
}

pub struct Input {
    pub order_id: String,
}

/// Confirms an order once its payment is authorised, and says so.
pub struct UseCase<O, P>
where
    O: Orders,
    P: Payments,
{
    orders: O,
    payments: P,
}

impl<O: Orders, P: Payments> UseCase<O, P> {
    pub async fn handle(&self, input: Input) -> Result<(), Error> {
        let mut order = self.orders.by_id(&input.order_id).await?;
        let authorization = self.payments.authorize(&order.id, &order.total).await?;
        let mut events = Vec::new();
        events.push(order.confirm(authorization)?);
        self.orders.save(&order, &events).await?;
        Ok(())
    }
}
