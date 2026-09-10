//! Runs the real tonic adapter over HTTP/2. The descriptor test independently
//! checks these generated consumer types against the Java provider's contract.
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use oms::application::order::usecases::request_payment::{Authorization, DeclineReason, Payments};
use oms::domain::order::vo::Money;
use oms::infrastructure::payments::client::PaymentsClient;
use oms::infrastructure::payments::generated::payments::v1::payment_service_server::{PaymentService, PaymentServiceServer};
use oms::infrastructure::payments::generated::payments::v1::{AuthorizeRequest, AuthorizeResponse};
use tonic::{Request, Response, Status};

#[derive(Clone)]
struct Ledger {
    requests: Arc<Mutex<Vec<AuthorizeRequest>>>,
    answers: Arc<Mutex<VecDeque<Result<AuthorizeResponse, Status>>>>,
}
#[tonic::async_trait]
impl PaymentService for Ledger {
    async fn authorize(&self, request: Request<AuthorizeRequest>) -> Result<Response<AuthorizeResponse>, Status> {
        self.requests.lock().unwrap().push(request.into_inner());
        self.answers.lock().unwrap().pop_front().unwrap().map(Response::new)
    }
}
fn answer(payment_id: &str, authorized: bool, reason: &str) -> Result<AuthorizeResponse, Status> {
    Ok(AuthorizeResponse {
        payment_id: payment_id.into(),
        authorized,
        reason: reason.into(),
    })
}
#[tokio::test]
async fn sends_the_stable_payment_id_and_maps_only_known_ledger_outcomes() {
    let ledger = Ledger {
        requests: Arc::default(),
        answers: Arc::new(Mutex::new(VecDeque::from([
            answer("o1", true, ""),
            answer("o1", false, "CARD_REFUSED"),
            answer("o1", false, "ORDER_CANCELLED"),
            answer("o1", false, "NEW_REASON"),
            answer("other", true, ""),
            answer("o1", true, "CARD_REFUSED"),
            Err(Status::unavailable("offline")),
        ]))),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let incoming = futures::stream::unfold(listener, |listener| async {
        let next = listener.accept().await.map(|(stream, _)| stream);
        Some((next, listener))
    });
    let service = ledger.clone();
    let server = tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(PaymentServiceServer::new(service))
            .serve_with_incoming(incoming)
            .await
            .unwrap();
    });
    let client = PaymentsClient::connect(&format!("http://{addr}")).unwrap();
    assert_eq!(
        client.authorize("o1", "o1", &Money::of(900, "EUR")).await.unwrap(),
        Authorization::Authorized { payment_id: "o1".into() }
    );
    assert_eq!(
        client.authorize("o1", "o1", &Money::of(900, "EUR")).await.unwrap(),
        Authorization::Declined(DeclineReason::CardRefused)
    );
    assert_eq!(
        client.authorize("o1", "o1", &Money::of(900, "EUR")).await.unwrap(),
        Authorization::Declined(DeclineReason::OrderCancelled)
    );
    for _ in 0..4 {
        assert!(client.authorize("o1", "o1", &Money::of(900, "EUR")).await.is_err());
    }
    let requests = ledger.requests.lock().unwrap();
    assert_eq!(requests.len(), 7);
    for r in requests.iter() {
        assert_eq!(
            (&r.payment_id, &r.order_id, r.amount_minor, r.currency.as_str()),
            (&"o1".to_string(), &"o1".to_string(), 900, "EUR")
        );
    }
    server.abort();
}
