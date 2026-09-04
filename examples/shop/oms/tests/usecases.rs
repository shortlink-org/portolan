//! The use cases against an in-memory store and a permissive ledger: what
//! each records, what each publishes, and what each refuses. The store is
//! faked here and real in postgres.rs; the domain's rules are tested where
//! they live.

use std::sync::Mutex;

use chrono::{DateTime, TimeZone, Utc};
use oms::application::order::usecases::confirm_order::Payments;
use oms::application::order::usecases::{Clock, cancel_order, confirm_order, get_order, place_order};
use oms::domain::order::event::Event;
use oms::domain::order::port::Orders;
use oms::domain::order::vo::Money;
use oms::domain::order::{Error, Line, Order, Status};

#[derive(Default)]
struct Memory {
    orders: Mutex<Vec<Order>>,
    published: Mutex<Vec<String>>,
}

impl Orders for Memory {
    async fn by_id(&self, id: &str) -> Result<Order, Error> {
        self.orders
            .lock()
            .unwrap()
            .iter()
            .find(|o| o.id == id)
            .cloned()
            .ok_or_else(|| Error::NotFound(id.into()))
    }
    async fn by_basket(&self, basket_id: &str) -> Result<Option<Order>, Error> {
        Ok(self.orders.lock().unwrap().iter().find(|o| o.basket_id == basket_id).cloned())
    }
    async fn save(&self, order: &Order, events: &[&dyn Event]) -> Result<(), Error> {
        let mut orders = self.orders.lock().unwrap();
        orders.retain(|o| o.id != order.id);
        orders.push(Order {
            version: order.version + 1,
            ..order.clone()
        });
        self.published.lock().unwrap().extend(events.iter().map(|e| e.name().to_string()));
        Ok(())
    }
}

struct Permissive;
impl Payments for Permissive {
    async fn authorize(&self, order_id: &str, _total: &Money) -> Result<String, Error> {
        Ok(format!("auth-{order_id}"))
    }
}

fn fixed() -> Clock {
    Box::new(|| Utc.with_ymd_and_hms(2026, 9, 5, 12, 0, 0).unwrap())
}

fn now() -> DateTime<Utc> {
    fixed()()
}

fn input(basket: &str) -> place_order::Input {
    place_order::Input {
        order_id: format!("o-{basket}"),
        customer_id: "u1".into(),
        basket_id: basket.into(),
        lines: vec![Line {
            sku: "tea".into(),
            quantity: 2,
            unit_price: Money::of(450, "EUR"),
        }],
        total: Money::of(900, "EUR"),
    }
}

#[tokio::test]
async fn placing_records_the_order_and_publishes_once_per_basket() {
    let store = Memory::default();
    let place = place_order::UseCase::new(&store, fixed());
    let id = place.handle(input("b1")).await.unwrap();
    let again = place.handle(input("b1")).await.unwrap();
    assert_eq!(id, "o-b1");
    assert_eq!(again, id, "a second checkout of the same basket answers with the first order");
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced"]);
    let read = get_order::UseCase::new(&store).handle(&id).await.unwrap();
    assert_eq!(read.status, Status::Placed);
    assert_eq!(read.placed_at, now());
}

#[tokio::test]
async fn confirming_asks_the_ledger_and_says_so() {
    let store = Memory::default();
    place_order::UseCase::new(&store, fixed()).handle(input("b1")).await.unwrap();
    confirm_order::UseCase::new(&store, Permissive, fixed())
        .handle(confirm_order::Input { order_id: "o-b1".into() })
        .await
        .unwrap();
    let read = get_order::UseCase::new(&store).handle("o-b1").await.unwrap();
    assert_eq!(read.status, Status::Confirmed);
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderConfirmed"]);
}

#[tokio::test]
async fn cancelling_twice_changes_nothing_the_second_time() {
    let store = Memory::default();
    place_order::UseCase::new(&store, fixed()).handle(input("b1")).await.unwrap();
    let cancel = cancel_order::UseCase::new(&store, fixed());
    cancel
        .handle(cancel_order::Input {
            order_id: "o-b1".into(),
            reason: "customer asked".into(),
        })
        .await
        .unwrap();
    cancel
        .handle(cancel_order::Input {
            order_id: "o-b1".into(),
            reason: "again".into(),
        })
        .await
        .unwrap();
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderCancelled"]);
    let missing = cancel
        .handle(cancel_order::Input {
            order_id: "nope".into(),
            reason: "x".into(),
        })
        .await;
    assert!(matches!(missing, Err(Error::NotFound(_))));
}

#[tokio::test]
async fn a_cancelled_order_cannot_be_confirmed() {
    let store = Memory::default();
    place_order::UseCase::new(&store, fixed()).handle(input("b1")).await.unwrap();
    cancel_order::UseCase::new(&store, fixed())
        .handle(cancel_order::Input {
            order_id: "o-b1".into(),
            reason: "x".into(),
        })
        .await
        .unwrap();
    let refused = confirm_order::UseCase::new(&store, Permissive, fixed())
        .handle(confirm_order::Input { order_id: "o-b1".into() })
        .await;
    assert!(matches!(
        refused,
        Err(Error::Move {
            from: "cancelled",
            to: "confirmed"
        })
    ));
}
