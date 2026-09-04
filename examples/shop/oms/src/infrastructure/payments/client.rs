use tonic::transport::Channel;

use super::generated::payments::v1::AuthorizeRequest;
use super::generated::payments::v1::payment_service_client::PaymentServiceClient;
use crate::application::order::usecases::confirm_order::Payments;
use crate::domain::order::Error;
use crate::domain::order::vo::Money;
use crate::telemetry::{client_span, inject};

/// The ledger over its gRPC API. The channel connects lazily, so a ledger
/// that is not there fails the first authorisation rather than the start.
pub struct PaymentsClient {
    inner: PaymentServiceClient<Channel>,
}

impl PaymentsClient {
    pub fn connect(addr: &str) -> Result<PaymentsClient, http::uri::InvalidUri> {
        let channel = Channel::from_shared(addr.to_string())?.connect_lazy();
        Ok(PaymentsClient {
            inner: PaymentServiceClient::new(channel),
        })
    }
}

impl Payments for PaymentsClient {
    async fn authorize(&self, order_id: &str, total: &Money) -> Result<String, Error> {
        let span = client_span("payments.v1.PaymentService", "Authorize");
        let _guard = span.enter();
        let mut request = tonic::Request::new(AuthorizeRequest {
            order_id: order_id.to_string(),
            amount_minor: total.amount_minor,
            currency: total.currency.clone(),
        });
        inject(&span, request.metadata_mut());
        drop(_guard);
        let mut client = self.inner.clone();
        let response = tracing::Instrument::instrument(client.authorize(request), span)
            .await
            .map_err(|s| Error::Store(format!("payments: {}", s.message())))?;
        Ok(response.into_inner().authorization_id)
    }
}
