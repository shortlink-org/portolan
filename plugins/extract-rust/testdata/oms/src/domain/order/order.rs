use super::event::{OrderCancelled, OrderConfirmed, OrderPlaced};
use super::vo::Money;
use super::{Error, Line, Status, TRANSITIONS};

/// An order: what a basket became at checkout, under one lock.
pub struct Order {
    pub id: String,
    pub customer_id: String,
    pub lines: Vec<Line>,
    pub total: Money,
    pub status: Status,
    pub version: u32,
}

impl Order {
    pub fn place(id: String, customer_id: String, basket_id: String, lines: Vec<Line>, total: Money) -> Result<(Order, OrderPlaced), Error> {
        if lines.is_empty() {
            return Err(Error::Empty);
        }
        let placed = OrderPlaced { order_id: id.clone(), basket_id, total: total.clone() };
        Ok((Order { id, customer_id, lines, total, status: Status::Placed, version: 0 }, placed))
    }

    pub fn confirm(&mut self, authorization: String) -> Result<OrderConfirmed, Error> {
        self.move_to(Status::Confirmed)?;
        Ok(OrderConfirmed { order_id: self.id.clone(), authorization })
    }

    pub fn cancel(&mut self, reason: String) -> Result<OrderCancelled, Error> {
        self.move_to(Status::Cancelled)?;
        Ok(OrderCancelled { order_id: self.id.clone(), reason })
    }

    pub fn lines(&self) -> &[Line] {
        &self.lines
    }

    fn move_to(&mut self, next: Status) -> Result<(), Error> {
        let from = self.status.as_str();
        let allowed = TRANSITIONS.iter().find(|(s, _)| *s == from).map(|(_, to)| to.contains(&next.as_str())).unwrap_or(false);
        if !allowed {
            return Err(Error::Move(next.as_str()));
        }
        self.status = next;
        Ok(())
    }
}
