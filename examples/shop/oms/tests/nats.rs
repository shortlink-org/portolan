//! The bus against a NATS server, started in Docker; skipped without one.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use oms::pkg::messaging::nats::NatsBus;
use oms::pkg::messaging::{Bus, Handler, METADATA_EVENT_NAME, Message};
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, GenericImage, ImageExt};

async fn nats() -> Option<(ContainerAsync<GenericImage>, String)> {
    let container = GenericImage::new("nats", "2.12-alpine")
        .with_exposed_port(4222.tcp())
        .with_wait_for(WaitFor::message_on_stderr("Server is ready"))
        .with_cmd(["-js"])
        .start()
        .await
        .ok()?;
    let port = container.get_host_port_ipv4(4222).await.ok()?;
    Some((container, format!("nats://127.0.0.1:{port}")))
}

fn message(uuid: &str, name: &str) -> Message {
    let mut metadata = BTreeMap::new();
    metadata.insert(METADATA_EVENT_NAME.to_string(), name.to_string());
    metadata.insert("otel_trace_id".to_string(), "0af7651916cd43dd8448eb211c80319c".to_string());
    Message {
        uuid: uuid.into(),
        topic: "shop.cart.basket".into(),
        payload: serde_json::json!({ "basketId": "b-1" }),
        metadata,
    }
}

async fn until(condition: impl Fn() -> bool) {
    for _ in 0..100 {
        if condition() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("gave up waiting");
}

#[tokio::test]
async fn hands_a_subscriber_its_event_once_however_often_the_publish_repeats_and_not_the_others() {
    let Some((_container, url)) = nats().await else {
        eprintln!("no Docker: skipping");
        return;
    };
    let bus = NatsBus::connect(&url, "oms-test").await.unwrap();
    let received: Arc<Mutex<Vec<Message>>> = Arc::default();
    let seen = received.clone();
    let handler: Handler = Arc::new(move |m: Message| {
        let seen = seen.clone();
        Box::pin(async move {
            seen.lock().unwrap().push(m);
            Ok(())
        })
    });
    bus.subscribe("shop.cart.basket", "cart.BasketCheckedOut", handler).await.unwrap();
    bus.publish(message("00000000-0000-4000-8000-000000000000", "cart.BasketCreated"))
        .await
        .unwrap();
    let one = message("11111111-1111-4111-8111-111111111111", "cart.BasketCheckedOut");
    bus.publish(one.clone()).await.unwrap();
    bus.publish(one.clone()).await.unwrap();
    until(|| !received.lock().unwrap().is_empty()).await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    {
        let got = received.lock().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].uuid, one.uuid);
        assert_eq!(got[0].payload, one.payload);
        assert_eq!(got[0].metadata, one.metadata);
    }
    bus.close().await;
}

#[tokio::test]
async fn keeps_what_was_published_while_nobody_was_listening_for_the_subscriber_that_arrives_later() {
    let Some((_container, url)) = nats().await else {
        eprintln!("no Docker: skipping");
        return;
    };
    let publisher = NatsBus::connect(&url, "cart-test").await.unwrap();
    let early = message("22222222-2222-4222-8222-222222222222", "cart.BasketCheckedOut");
    publisher.publish(early.clone()).await.unwrap();

    let later = NatsBus::connect(&url, "oms-test").await.unwrap();
    let received: Arc<Mutex<Vec<String>>> = Arc::default();
    let seen = received.clone();
    let handler: Handler = Arc::new(move |m: Message| {
        let seen = seen.clone();
        Box::pin(async move {
            seen.lock().unwrap().push(m.uuid);
            Ok(())
        })
    });
    later.subscribe("shop.cart.basket", "cart.BasketCheckedOut", handler).await.unwrap();
    until(|| received.lock().unwrap().contains(&early.uuid)).await;
    later.close().await;
    publisher.close().await;
}
