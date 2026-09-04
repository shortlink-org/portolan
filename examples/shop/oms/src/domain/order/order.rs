use chrono::{DateTime, Utc};

use super::event::{OrderCancelled, OrderConfirmed, OrderPlaced};
use super::status::can_move;
use super::vo::Money;
use super::{Error, Line, Status};

/// The root. Everything about an order changes through a method here, and
/// every method that changes something hands back the event that says so:
/// the caller records both in one transaction, or neither.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    pub id: String,
    pub customer_id: String,
    pub basket_id: String,
    pub lines: Vec<Line>,
    pub total: Money,
    pub status: Status,
    pub placed_at: DateTime<Utc>,
    /// Bumped on every save; a save from a stale read is refused (Error::Conflict).
    pub version: u32,
}

impl Order {
    /// An order from a checked-out basket. The lines and the total are the
    /// basket's, taken as given: an empty basket and a basket whose lines
    /// disagree with the total's currency are refused, nothing else is judged
    /// here (ADR oms.0002).
    pub fn place(
        id: String,
        customer_id: String,
        basket_id: String,
        lines: Vec<Line>,
        total: Money,
        now: DateTime<Utc>,
    ) -> Result<(Order, OrderPlaced), Error> {
        if lines.is_empty() {
            return Err(Error::Empty);
        }
        if lines.iter().any(|l| l.unit_price.currency != total.currency) {
            return Err(Error::Currency);
        }
        let placed = OrderPlaced {
            order_id: id.clone(),
            basket_id: basket_id.clone(),
            customer_id: customer_id.clone(),
            total: total.clone(),
            occurred_at: now,
        };
        let order = Order {
            id,
            customer_id,
            basket_id,
            lines,
            total,
            status: Status::Placed,
            placed_at: now,
            version: 0,
        };
        Ok((order, placed))
    }

    /// The payment is authorised: the order may be fulfilled.
    pub fn confirm(&mut self, authorization_id: String, now: DateTime<Utc>) -> Result<OrderConfirmed, Error> {
        self.move_to(Status::Confirmed)?;
        Ok(OrderConfirmed {
            order_id: self.id.clone(),
            authorization_id,
            occurred_at: now,
        })
    }

    /// The order will not be fulfilled. Allowed until the parcel moves, which
    /// this service does not know about yet (ADR oms.0004).
    pub fn cancel(&mut self, reason: String, now: DateTime<Utc>) -> Result<OrderCancelled, Error> {
        self.move_to(Status::Cancelled)?;
        Ok(OrderCancelled {
            order_id: self.id.clone(),
            reason,
            occurred_at: now,
        })
    }

    /// The one way the status changes, held to the table.
    fn move_to(&mut self, next: Status) -> Result<(), Error> {
        if !can_move(self.status, next) {
            return Err(Error::Move {
                from: self.status.as_str(),
                to: next.as_str(),
            });
        }
        self.status = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::order::TRANSITIONS;

    fn lines() -> Vec<Line> {
        vec![Line {
            sku: "tea".into(),
            quantity: 2,
            unit_price: Money::of(450, "EUR"),
        }]
    }

    #[test]
    fn placing_copies_the_basket_and_says_so() {
        let now = Utc::now();
        let (order, placed) = Order::place("o1".into(), "u1".into(), "b1".into(), lines(), Money::of(900, "EUR"), now).unwrap();
        assert_eq!(order.status, Status::Placed);
        assert_eq!(order.lines.len(), 1);
        assert_eq!(placed.order_id, "o1");
        assert_eq!(placed.basket_id, "b1");
        assert_eq!(placed.total, Money::of(900, "EUR"));
    }

    #[test]
    fn an_empty_or_mixed_basket_places_nothing() {
        let now = Utc::now();
        assert!(matches!(
            Order::place("o".into(), "u".into(), "b".into(), vec![], Money::of(0, "EUR"), now),
            Err(Error::Empty)
        ));
        assert!(matches!(
            Order::place("o".into(), "u".into(), "b".into(), lines(), Money::of(900, "USD"), now),
            Err(Error::Currency)
        ));
    }

    #[test]
    fn the_lifecycle_follows_the_table() {
        let now = Utc::now();
        let (mut order, _) = Order::place("o1".into(), "u1".into(), "b1".into(), lines(), Money::of(900, "EUR"), now).unwrap();
        let confirmed = order.confirm("auth-1".into(), now).unwrap();
        assert_eq!(confirmed.authorization_id, "auth-1");
        assert_eq!(order.status, Status::Confirmed);
        assert!(matches!(
            order.confirm("auth-2".into(), now),
            Err(Error::Move {
                from: "confirmed",
                to: "confirmed"
            })
        ));
        order.cancel("customer asked".into(), now).unwrap();
        assert_eq!(order.status, Status::Cancelled);
        assert!(matches!(order.cancel("again".into(), now), Err(Error::Move { .. })));
    }

    #[test]
    fn every_edge_in_the_table_is_one_a_method_makes() {
        for (from, targets) in TRANSITIONS {
            for to in *targets {
                assert!(can_move(Status::parse(from).unwrap(), Status::parse(to).unwrap()));
            }
        }
    }
}
