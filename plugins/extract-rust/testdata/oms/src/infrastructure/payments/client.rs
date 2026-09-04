use super::gen::payment_service_client::PaymentServiceClient;
use super::gen::AuthorizeRequest;
use crate::application::order::usecases::confirm_order::Payments;
use crate::domain::order::vo::Money;
use crate::domain::order::Error;

/// The ledger over its gRPC API.
pub struct PaymentsClient {
    inner: PaymentServiceClient<String>,
}

impl Payments for PaymentsClient {
    async fn authorize(&self, order_id: &str, total: &Money) -> Result<String, Error> {
        let mut client = PaymentServiceClient { inner: self.inner.inner.clone() };
        let res = client.authorize(AuthorizeRequest { order_id: order_id.to_string(), amount_minor: total.amount_minor, currency: total.currency.clone() }).await.map_err(|_| Error::Empty)?;
        Ok(res.authorization_id)
    }
}
