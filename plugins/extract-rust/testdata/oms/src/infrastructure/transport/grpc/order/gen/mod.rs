// A stand-in for tonic's output, enough for the fixture to parse.
pub mod order_service_server {
    pub trait OrderService {
        async fn get_order(&self, request: super::GetOrderRequest) -> Result<super::GetOrderResponse, String>;
        async fn cancel_order(&self, request: super::CancelOrderRequest) -> Result<super::CancelOrderResponse, String>;
    }
}

pub struct GetOrderRequest {
    pub order_id: String,
}
pub struct GetOrderResponse {
    pub order_id: String,
}
pub struct CancelOrderRequest {
    pub order_id: String,
    pub reason: String,
}
pub struct CancelOrderResponse {
    pub order_id: String,
}
