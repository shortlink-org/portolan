use std::sync::Arc;

use super::gen::order_service_server::OrderService;
use super::gen::{CancelOrderRequest, CancelOrderResponse, GetOrderRequest, GetOrderResponse};
use crate::application::order::usecases::{cancel_order, get_order};
use crate::infrastructure::repository::order::PostgresOrders;

pub struct OrderHandlers {
    get_order: Arc<get_order::UseCase>,
    cancel_order: Arc<cancel_order::UseCase<PostgresOrders>>,
}

impl OrderService for OrderHandlers {
    async fn get_order(&self, request: GetOrderRequest) -> Result<GetOrderResponse, String> {
        let order = self.get_order.handle(&request.order_id).await.map_err(|_| "not found".to_string())?;
        Ok(GetOrderResponse { order_id: order.id })
    }

    async fn cancel_order(&self, request: CancelOrderRequest) -> Result<CancelOrderResponse, String> {
        self.cancel_order.handle(cancel_order::Input { order_id: request.order_id.clone(), reason: request.reason }).await.map_err(|_| "conflict".to_string())?;
        Ok(CancelOrderResponse { order_id: request.order_id })
    }
}
