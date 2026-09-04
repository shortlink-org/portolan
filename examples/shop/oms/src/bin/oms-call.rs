//! A caller for the recording: one rpc per invocation, so `telemetry/record.sh`
//! needs no tool that is not already built here.
//!
//!   oms-call get <order id>
//!   oms-call cancel <order id>

use oms::infrastructure::transport::grpc::order::generated::shop::v1::order_service_client::OrderServiceClient;
use oms::infrastructure::transport::grpc::order::generated::shop::v1::{CancelOrderRequest, GetOrderRequest};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let (Some(verb), Some(order_id)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: oms-call get|cancel <order id>");
        std::process::exit(2);
    };
    let addr = std::env::var("GRPC_ADDR")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:50051".into());
    let addr = if addr.starts_with("http") { addr } else { format!("http://{addr}") };
    let mut client = OrderServiceClient::connect(addr).await?;
    match verb.as_str() {
        "get" => {
            let order = client.get_order(GetOrderRequest { order_id: order_id.clone() }).await?.into_inner().order;
            println!("{}", serde_json::to_string(&order.map(|o| (o.id, o.status)))?);
        }
        "cancel" => {
            let order = client.cancel_order(CancelOrderRequest { order_id: order_id.clone() }).await?.into_inner().order;
            println!("{}", serde_json::to_string(&order.map(|o| (o.id, o.status)))?);
        }
        other => {
            eprintln!("unknown verb {other}");
            std::process::exit(2);
        }
    }
    Ok(())
}
