use crate::domain::order::vo::Money;

/// The cart's BasketCheckedOut, decoded off the bus: the fields this service reads.
pub struct BasketCheckedOut {
    pub basket_id: String,
    pub customer_id: String,
    pub total: Money,
}
