use crate::application::order::usecases::confirm_order::Payments;
use crate::domain::order::vo::Money;
use crate::domain::order::Error;

/// Authorises everything, for running without a ledger.
pub struct PermissivePayments;

impl Payments for PermissivePayments {
    async fn authorize(&self, order_id: &str, _total: &Money) -> Result<String, Error> {
        Ok(format!("auth-{order_id}"))
    }
}
