//! The repository against a real Postgres, started in Docker. Without Docker
//! the suite is skipped rather than failed: the use cases are covered against
//! the in-memory store, and this is the one file that needs a database.

use chrono::{TimeZone, Utc};
use oms::domain::order::event::Event;
use oms::domain::order::port::Orders;
use oms::domain::order::vo::Money;
use oms::domain::order::{Error, Line, Order, Status};
use oms::infrastructure::repository::order::PostgresOrders;
use sqlx::Row;
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, GenericImage, ImageExt};

async fn postgres() -> Option<(ContainerAsync<GenericImage>, sqlx::PgPool)> {
    let container = GenericImage::new("postgres", "18-alpine")
        .with_exposed_port(5432.tcp())
        .with_wait_for(WaitFor::message_on_stderr("database system is ready to accept connections"))
        .with_env_var("POSTGRES_USER", "oms")
        .with_env_var("POSTGRES_PASSWORD", "oms")
        .with_env_var("POSTGRES_DB", "oms")
        .start()
        .await
        .ok()?;
    let port = container.get_host_port_ipv4(5432).await.ok()?;
    let url = format!("postgres://oms:oms@127.0.0.1:{port}/oms");
    let mut pool = None;
    for _ in 0..30 {
        if let Ok(p) = sqlx::postgres::PgPoolOptions::new().connect(&url).await {
            pool = Some(p);
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    let pool = pool?;
    sqlx::migrate!("./src/infrastructure/repository/order/migrations").run(&pool).await.ok()?;
    Some((container, pool))
}

fn order(id: &str, basket: &str) -> (Order, impl Event) {
    let now = Utc.with_ymd_and_hms(2026, 9, 5, 12, 0, 0).unwrap();
    Order::place(
        id.into(),
        "u1".into(),
        basket.into(),
        vec![Line {
            sku: "tea".into(),
            quantity: 2,
            unit_price: Money::of(450, "EUR"),
        }],
        Money::of(900, "EUR"),
        now,
    )
    .unwrap()
}

#[tokio::test]
async fn keeps_an_order_and_its_lines_and_the_events_in_the_outbox_beside_them() {
    let Some((_container, pool)) = postgres().await else {
        eprintln!("no Docker: skipping");
        return;
    };
    let repo = PostgresOrders::new(pool.clone());
    let (placed_order, placed) = order("o1", "b1");
    repo.save(&placed_order, &[&placed]).await.unwrap();

    let read = repo.by_id("o1").await.unwrap();
    assert_eq!(read.lines, placed_order.lines);
    assert_eq!(read.total, Money::of(900, "EUR"));
    assert_eq!(read.status, Status::Placed);
    assert_eq!(read.version, 1);
    assert_eq!(repo.by_basket("b1").await.unwrap().map(|o| o.id), Some("o1".into()));
    assert!(repo.by_basket("nope").await.unwrap().is_none());
    assert!(matches!(repo.by_id("nope").await, Err(Error::NotFound(_))));

    let outbox = sqlx::query("SELECT topic, metadata FROM outbox ORDER BY id").fetch_all(&pool).await.unwrap();
    let rows: Vec<String> = outbox
        .iter()
        .map(|r| {
            format!(
                "{}:{}",
                r.get::<String, _>("topic"),
                r.get::<serde_json::Value, _>("metadata")["event_name"].as_str().unwrap()
            )
        })
        .collect();
    assert_eq!(rows, vec!["shop.oms.order:oms.OrderPlaced"]);
}

#[tokio::test]
async fn refuses_a_write_from_a_stale_read_and_a_second_order_for_one_basket() {
    let Some((_container, pool)) = postgres().await else {
        eprintln!("no Docker: skipping");
        return;
    };
    let repo = PostgresOrders::new(pool.clone());
    let (placed_order, placed) = order("o2", "b2");
    repo.save(&placed_order, &[&placed]).await.unwrap();
    let mut one = repo.by_id("o2").await.unwrap();
    let mut two = repo.by_id("o2").await.unwrap();
    let now = Utc::now();
    let confirmed = one.confirm("auth".into(), now).unwrap();
    repo.save(&one, &[&confirmed]).await.unwrap();
    let cancelled = two.cancel("late".into(), now).unwrap();
    assert!(matches!(repo.save(&two, &[&cancelled]).await, Err(Error::Conflict)));

    let (again, placed_again) = order("o3", "b2");
    assert!(matches!(repo.save(&again, &[&placed_again]).await, Err(Error::Conflict)));
}
