use crate::application::order::usecases::confirm_order::Payments;
use crate::domain::order::Error;
use crate::domain::order::vo::Money;

/// Authorises everything, for running without a ledger. What it hands back is
/// recognisably not an authorisation, so a page showing one is not mistaken
/// for the real thing.
pub struct PermissivePayments;

impl Payments for PermissivePayments {
    async fn authorize(&self, order_id: &str, _total: &Money) -> Result<String, Error> {
        Ok(format!("stand-in:{order_id}"))
    }
}
