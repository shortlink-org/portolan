use chrono::{DateTime, Utc};

use crate::domain::order::port::Orders;
use crate::domain::order::vo::Money;
use crate::domain::order::{Error, Order, Status};

/// What a caller may see of an order: everything on it except the version.
/// The version names a row in this store; handed out, it would invite a save
/// on a copy nobody re-read. The root itself never crosses this edge - a
/// query answers, it does not lend the aggregate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    pub order_id: String,
    pub customer_id: String,
    pub basket_id: String,
    pub status: Status,
    pub lines: Vec<Line>,
    pub total: Money,
    pub placed_at: DateTime<Utc>,
}

/// One line as the caller reads it: the SKU, how many, and the price the
/// basket promised (ADR oms.0003).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub sku: String,
    pub quantity: u32,
    pub unit_price: Money,
}

pub struct UseCase<O: Orders> {
    orders: O,
}

impl<O: Orders> UseCase<O> {
    pub fn new(orders: O) -> Self {
        UseCase { orders }
    }

    /// Answers with the order as it is now; a cancelled order is still found.
    pub async fn handle(&self, id: &str) -> Result<Output, Error> {
        let order = self.orders.by_id(id).await?;
        Ok(view(order))
    }
}

fn view(order: Order) -> Output {
    Output {
        order_id: order.id,
        customer_id: order.customer_id,
        basket_id: order.basket_id,
        status: order.status,
        lines: order
            .lines
            .into_iter()
            .map(|l| Line {
                sku: l.sku,
                quantity: l.quantity,
                unit_price: l.unit_price,
            })
            .collect(),
        total: order.total,
        placed_at: order.placed_at,
    }
}
