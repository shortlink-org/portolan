use std::sync::Arc;

use tonic::{Request, Response, Status};
use tracing::Instrument;

use super::generated::shop::v1::order_service_server::OrderService;
use super::generated::shop::v1::{CancelOrderRequest, CancelOrderResponse, GetOrderRequest, GetOrderResponse, Line, Money, Order, OrderStatus};
use crate::application::order::usecases::{cancel_order, get_order};
use crate::domain::order;
use crate::domain::order::port::Orders;
use crate::telemetry::server_span;

pub const SERVICE: &str = "shop.v1.OrderService";

/// The edge: a method per rpc, each opening the server span, running its use
/// case and mapping the domain's refusals to a status. Nothing is decided
/// here.
pub struct OrderHandlers<O: Orders> {
    get_order: Arc<get_order::UseCase<O>>,
    cancel_order: Arc<cancel_order::UseCase<O>>,
}

impl<O: Orders> OrderHandlers<O> {
    pub fn new(get_order: Arc<get_order::UseCase<O>>, cancel_order: Arc<cancel_order::UseCase<O>>) -> Self {
        OrderHandlers { get_order, cancel_order }
    }
}

#[tonic::async_trait]
impl<O: Orders + 'static> OrderService for OrderHandlers<O> {
    async fn get_order(&self, request: Request<GetOrderRequest>) -> Result<Response<GetOrderResponse>, Status> {
        let span = server_span(SERVICE, "GetOrder", request.metadata());
        async move {
            let order = self.get_order.handle(&request.into_inner().order_id).await.map_err(status)?;
            Ok(Response::new(GetOrderResponse { order: Some(to_proto(&order)) }))
        }
        .instrument(span)
        .await
    }

    async fn cancel_order(&self, request: Request<CancelOrderRequest>) -> Result<Response<CancelOrderResponse>, Status> {
        let span = server_span(SERVICE, "CancelOrder", request.metadata());
        async move {
            let order_id = request.into_inner().order_id;
            self.cancel_order
                .handle(cancel_order::Input {
                    order_id: order_id.clone(),
                    reason: "customer asked".into(),
                })
                .await
                .map_err(status)?;
            let order = self.get_order.handle(&order_id).await.map_err(status)?;
            Ok(Response::new(CancelOrderResponse { order: Some(to_proto(&order)) }))
        }
        .instrument(span)
        .await
    }
}

/// The one place a domain error becomes a status. What a caller may act on
/// is named; a storage failure is `internal` and says nothing more.
fn status(e: order::Error) -> Status {
    match e {
        order::Error::NotFound(id) => Status::not_found(format!("no order {id}")),
        order::Error::Move { from, to } => Status::failed_precondition(format!("a {from} order cannot become {to}")),
        order::Error::Conflict => Status::aborted("the order was changed by somebody else; read it again"),
        order::Error::Empty | order::Error::Currency => Status::invalid_argument(e.to_string()),
        order::Error::Store(_) => Status::internal("the order could not be read or written"),
    }
}

/// The read DTO, as the wire spells it. It is the query's `Output` that is
/// mapped, not the aggregate: the root never reaches this file.
fn to_proto(o: &get_order::Output) -> Order {
    Order {
        id: o.order_id.clone(),
        customer_id: o.customer_id.clone(),
        basket_id: o.basket_id.clone(),
        status: match o.status {
            order::Status::Placed => OrderStatus::Placed,
            order::Status::Confirmed => OrderStatus::Confirmed,
            order::Status::Cancelled => OrderStatus::Cancelled,
        } as i32,
        lines: o
            .lines
            .iter()
            .map(|l| Line {
                sku: l.sku.clone(),
                quantity: l.quantity as i32,
                unit_price: Some(money(&l.unit_price)),
            })
            .collect(),
        total: Some(money(&o.total)),
        placed_at: Some(prost_types::Timestamp {
            seconds: o.placed_at.timestamp(),
            nanos: o.placed_at.timestamp_subsec_nanos() as i32,
        }),
    }
}

fn money(m: &order::vo::Money) -> Money {
    Money {
        amount_minor: m.amount_minor,
        currency: m.currency.clone(),
    }
}
