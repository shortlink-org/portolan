// A stand-in for tonic's output, enough for the fixture to parse.
pub mod payment_service_client {
    pub struct PaymentServiceClient<T> {
        pub inner: T,
    }
    impl<T: Clone> PaymentServiceClient<T> {
        pub async fn authorize(&mut self, _req: super::AuthorizeRequest) -> Result<super::AuthorizeResponse, ()> {
            Err(())
        }
    }
}

pub struct AuthorizeRequest {
    pub order_id: String,
    pub amount_minor: i64,
    pub currency: String,
}

pub struct AuthorizeResponse {
    pub authorization_id: String,
}
