use crate::application::order::usecases::request_payment::{Authorization, Payments};
use crate::domain::order::Error;
use crate::domain::order::vo::Money;

/// Explicit local-only stand-in. Production examples set PAYMENTS_ADDR.
pub struct PermissivePayments;

impl Payments for PermissivePayments {
    async fn authorize(&self, payment_id: &str, _order_id: &str, _total: &Money) -> Result<Authorization, Error> {
        Ok(Authorization::Authorized { payment_id: payment_id.into() })
    }
}
