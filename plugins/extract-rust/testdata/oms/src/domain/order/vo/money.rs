/// An amount in the minor unit of a currency.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Money {
    pub amount_minor: i64,
    pub currency: String,
}
