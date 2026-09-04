use serde::{Deserialize, Serialize};

/// An amount in the minor unit of a currency: 1999 EUR is 19.99. The currency
/// is three upper-case letters and nothing checks it further; the order only
/// requires every line to agree with the total on it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Money {
    pub amount_minor: i64,
    pub currency: String,
}

impl Money {
    pub fn of(amount_minor: i64, currency: &str) -> Money {
        Money {
            amount_minor,
            currency: currency.to_string(),
        }
    }
}
