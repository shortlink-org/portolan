//! The ledger, over its gRPC contract - and a stand-in for running without
//! one. Which of the two is assembly's choice, and the use case cannot tell.

pub mod client;
#[path = "gen/mod.rs"]
pub mod generated;
pub mod stand_in;

use crate::application::order::usecases::request_payment::{Authorization, Payments};
use crate::domain::order::Error;
use crate::domain::order::vo::Money;

/// The one the assembly picked.
pub enum AnyPayments {
    Client(client::PaymentsClient),
    Permissive(stand_in::PermissivePayments),
}

impl Payments for AnyPayments {
    async fn authorize(&self, payment_id: &str, order_id: &str, total: &Money) -> Result<Authorization, Error> {
        match self {
            AnyPayments::Client(c) => c.authorize(payment_id, order_id, total).await,
            AnyPayments::Permissive(p) => p.authorize(payment_id, order_id, total).await,
        }
    }
}
