//! Runs the service. It does four things and no more: trace if told to,
//! assemble, listen, and run the relay and the subscriptions beside the
//! listener until told to stop. The bus is opened before listening, so a
//! wrong NATS_URL is a service that never came up rather than one that took
//! orders it could not deliver.

use std::sync::Arc;

use oms::application::order::usecases::{cancel_order, confirm_order, get_order, place_order, wall_clock};
use oms::application::policy::confirm_order_on_payment_authorized::ConfirmOrderOnPaymentAuthorized;
use oms::application::policy::place_order_on_basket_checked_out::PlaceOrderOnBasketCheckedOut;
use oms::infrastructure::cart::{self, BasketCheckedOut};
use oms::infrastructure::payments::{AnyPayments, client::PaymentsClient, stand_in::PermissivePayments};
use oms::infrastructure::repository::order::PostgresOrders;
use oms::infrastructure::transport::grpc::order::OrderHandlers;
use oms::infrastructure::transport::grpc::order::generated::shop::v1::order_service_server::OrderServiceServer;
use oms::pkg::messaging::inproc::InProcBus;
use oms::pkg::messaging::nats::NatsBus;
use oms::pkg::messaging::{AnyBus, Bus, BusError, Handler, Message};
use oms::pkg::outbox::relay::Relay;
use oms::telemetry;

/// The subject the ledger will publish on, when there is a ledger: declared
/// here ahead of it, so the catalog can say the subscription exists.
const PAYMENTS_TOPIC: &str = "payments.ledger.payment";
const PAYMENT_AUTHORIZED: &str = "payments.PaymentAuthorized";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let provider = telemetry::init(env("TRACER_URI").as_deref(), &env("SERVICE_NAME").unwrap_or_else(|| "oms".into()));

    let database_url = env("STORE_POSTGRES_URI").unwrap_or_else(|| "postgres://oms:oms@localhost:5434/oms".into());
    let pool = sqlx::postgres::PgPoolOptions::new().max_connections(8).connect(&database_url).await?;
    sqlx::migrate!("./src/infrastructure/repository/order/migrations").run(&pool).await?;

    // The bus. Over NATS when there is one to talk to; in process otherwise,
    // and neither the relay nor a policy can tell which it was handed.
    let bus = match env("NATS_URL") {
        Some(url) => AnyBus::Nats(Box::new(NatsBus::connect(&url, "oms").await?)),
        None => AnyBus::InProc(InProcBus::default()),
    };
    // The peers. A stand-in is assembly's choice and the use case cannot tell.
    let payments = match env("PAYMENTS_ADDR") {
        Some(addr) => AnyPayments::Client(PaymentsClient::connect(&addr)?),
        None => AnyPayments::Permissive(PermissivePayments),
    };

    let orders = PostgresOrders::new(pool.clone());
    let place_order = Arc::new(place_order::UseCase::new(orders.clone(), wall_clock()));
    let get_order = Arc::new(get_order::UseCase::new(orders.clone()));
    let confirm_order = Arc::new(confirm_order::UseCase::new(orders.clone(), payments, wall_clock()));
    let cancel_order = Arc::new(cancel_order::UseCase::new(orders.clone(), wall_clock()));

    // The policies, subscribed on the bus by the subject their event travels on.
    let on_checkout = Arc::new(PlaceOrderOnBasketCheckedOut::new(place_order));
    let handler: Handler = Arc::new(move |message: Message| {
        let policy = on_checkout.clone();
        Box::pin(async move {
            let event = BasketCheckedOut::decode(&message.payload).map_err(|e| BusError(format!("decoding {}: {e}", cart::BASKET_CHECKED_OUT)))?;
            policy.handle(&event).await.map_err(|e| BusError(e.to_string()))
        })
    });
    bus.subscribe(cart::TOPIC, cart::BASKET_CHECKED_OUT, handler).await?;
    let on_authorized = Arc::new(ConfirmOrderOnPaymentAuthorized::new(confirm_order));
    let handler: Handler = Arc::new(move |message: Message| {
        let policy = on_authorized.clone();
        Box::pin(async move { policy.handle(&message).await.map_err(|e| BusError(e.to_string())) })
    });
    bus.subscribe(PAYMENTS_TOPIC, PAYMENT_AUTHORIZED, handler).await?;

    let addr = env("GRPC_ADDR").unwrap_or_else(|| "127.0.0.1:50051".into()).parse()?;
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let relay = Arc::new(Relay::new(pool.clone(), bus));
    let relaying = {
        let relay = relay.clone();
        tokio::spawn(async move { relay.run(stop_rx).await })
    };
    tracing::info!("oms: listening on {addr}");
    let server = tonic::transport::Server::builder()
        .add_service(OrderServiceServer::new(OrderHandlers::new(get_order, cancel_order)))
        .serve_with_shutdown(addr, async {
            let ctrl_c = tokio::signal::ctrl_c();
            #[cfg(unix)]
            {
                let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("a SIGTERM handler");
                tokio::select! {
                    _ = ctrl_c => {}
                    _ = term.recv() => {}
                }
            }
            #[cfg(not(unix))]
            {
                let _ = ctrl_c.await;
            }
        });
    server.await?;

    let _ = stop_tx.send(true);
    match relaying.await {
        Ok(Err(e)) => tracing::error!("oms: relay: {e}"),
        Err(e) => tracing::error!("oms: relay: {e}"),
        Ok(Ok(())) => {}
    }
    relay.bus().close().await;
    pool.close().await;
    if let Some(provider) = provider {
        let _ = provider.shutdown();
    }
    tracing::info!("oms: stopped");
    Ok(())
}
