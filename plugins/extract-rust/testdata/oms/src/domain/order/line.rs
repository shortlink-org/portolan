use super::vo::Money;

/// One line of the order, at the price it was added to the basket at.
pub struct Line {
    pub sku: String,
    pub quantity: u32,
    pub unit_price: Money,
}
