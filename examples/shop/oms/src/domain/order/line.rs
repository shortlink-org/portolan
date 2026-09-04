use super::vo::Money;

/// One line of the order: a SKU, how many, and the price it was added to the
/// basket at. The price is copied from the basket and never recomputed (ADR
/// oms.0003); the customer agreed to this number.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub sku: String,
    pub quantity: u32,
    pub unit_price: Money,
}
