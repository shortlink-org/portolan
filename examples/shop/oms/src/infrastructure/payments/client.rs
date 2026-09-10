use tonic::transport::Channel;

use super::generated::payments::v1::AuthorizeRequest;
use super::generated::payments::v1::payment_service_client::PaymentServiceClient;
use crate::application::order::usecases::request_payment::{Authorization, Payments};
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
    async fn authorize(&self, payment_id: &str, order_id: &str, total: &Money) -> Result<Authorization, Error> {
        let span = client_span("payments.v1.PaymentService", "Authorize");
        let _guard = span.enter();
        let mut request = tonic::Request::new(AuthorizeRequest {
            payment_id: payment_id.to_string(),
            order_id: order_id.to_string(),
            amount_minor: total.amount_minor,
            currency: total.currency.clone(),
        });
        request.set_timeout(std::time::Duration::from_secs(10));
        inject(&span, request.metadata_mut());
        drop(_guard);
        let mut client = self.inner.clone();
        let response = tracing::Instrument::instrument(client.authorize(request), span)
            .await
            .map_err(|s| Error::Payment(s.message().to_string()))?;
        let answer = response.into_inner();
        if answer.payment_id != payment_id {
            return Err(Error::Payment("ledger answered for a different payment".into()));
        }
        use crate::application::order::usecases::request_payment::DeclineReason;
        match (answer.authorized, answer.reason.as_str()) {
            (true, "") => Ok(Authorization::Authorized { payment_id: answer.payment_id }),
            (false, "CARD_REFUSED") => Ok(Authorization::Declined(DeclineReason::CardRefused)),
            (false, "ORDER_CANCELLED") => Ok(Authorization::Declined(DeclineReason::OrderCancelled)),
            _ => Err(Error::Payment("ledger returned an unknown authorization outcome".into())),
        }
    }
}
