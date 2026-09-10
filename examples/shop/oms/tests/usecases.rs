//! The use cases against an in-memory store and a permissive ledger: what
//! each records, what each publishes, and what each refuses. The store is
//! faked here and real in postgres.rs; the domain's rules are tested where
//! they live.

use std::sync::Mutex;

use chrono::{DateTime, TimeZone, Utc};
use oms::application::order::usecases::request_payment::{Authorization, Payments};
use oms::application::order::usecases::{Clock, cancel_order, confirm_order, get_order, place_order, request_payment};
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
        if let Some(current) = orders.iter().find(|o| o.id == order.id) {
            if current.version != order.version {
                return Err(Error::Conflict);
            }
        } else if order.version != 0 {
            return Err(Error::Conflict);
        }
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
    async fn authorize(&self, payment_id: &str, _order_id: &str, _total: &Money) -> Result<Authorization, Error> {
        Ok(Authorization::Authorized { payment_id: payment_id.into() })
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
async fn confirming_a_fact_says_so_once_without_calling_the_ledger() {
    let store = Memory::default();
    place_order::UseCase::new(&store, fixed()).handle(input("b1")).await.unwrap();
    confirm_order::UseCase::new(&store).handle(confirmation("o-b1")).await.unwrap();
    confirm_order::UseCase::new(&store).handle(confirmation("o-b1")).await.unwrap();
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
async fn a_late_authorization_cannot_resurrect_a_cancelled_order() {
    let store = Memory::default();
    place_order::UseCase::new(&store, fixed()).handle(input("b1")).await.unwrap();
    cancel_order::UseCase::new(&store, fixed())
        .handle(cancel_order::Input {
            order_id: "o-b1".into(),
            reason: "x".into(),
        })
        .await
        .unwrap();
    let refused = confirm_order::UseCase::new(&store).handle(confirmation("o-b1")).await;
    refused.unwrap();
    assert_eq!(store.by_id("o-b1").await.unwrap().status, Status::Cancelled);
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderCancelled"]);
}

fn confirmation(order_id: &str) -> confirm_order::Input {
    confirm_order::Input {
        order_id: order_id.into(),
        payment_id: order_id.into(),
        amount: Money::of(900, "EUR"),
        authorized_at: now(),
    }
}

fn message(topic: &str, name: &str, payload: serde_json::Value) -> oms::pkg::messaging::Message {
    oms::pkg::messaging::Message {
        uuid: "delivery-1".into(),
        topic: topic.into(),
        payload,
        metadata: [(oms::pkg::messaging::METADATA_EVENT_NAME.into(), name.into())].into(),
    }
}

#[tokio::test]
async fn actual_cart_wire_places_an_order_and_requests_payment_with_stable_identity() {
    use oms::application::policy::place_order_on_basket_checked_out::PlaceOrderOnBasketCheckedOut;
    use oms::application::policy::request_payment_on_order_placed::{ORDER_PLACED, RequestPaymentOnOrderPlaced};
    use std::sync::Arc;
    let store = Arc::new(Memory::default());
    let payload = serde_json::from_str(include_str!("../../../scenarios/fixtures/basket-checked-out.json")).unwrap();
    let event = oms::infrastructure::cart::BasketCheckedOut::decode(&payload).unwrap();
    let place = PlaceOrderOnBasketCheckedOut::new(Arc::new(place_order::UseCase::new(store.clone(), fixed())));
    place.handle(&event).await.unwrap();
    place.handle(&event).await.unwrap();
    let confirm = Arc::new(confirm_order::UseCase::new(store.clone()));
    let policy = RequestPaymentOnOrderPlaced::new(Arc::new(request_payment::UseCase::new(store.clone(), Permissive)), confirm.clone(), fixed());
    let placed = message("shop.oms.order", ORDER_PLACED, serde_json::json!({"orderId":event.basket_id}));
    policy.handle(&placed).await.unwrap();
    policy.handle(&placed).await.unwrap();
    let authorized = message(
        oms::infrastructure::payments::TOPIC,
        oms::infrastructure::payments::PAYMENT_AUTHORIZED,
        serde_json::from_str(include_str!("../../../scenarios/fixtures/payment-authorized.json")).unwrap(),
    );
    let on_authorized = oms::application::policy::confirm_order_on_payment_authorized::ConfirmOrderOnPaymentAuthorized::new(confirm);
    on_authorized.handle(&authorized).await.unwrap();
    assert_eq!(store.by_id(&event.basket_id).await.unwrap().status, Status::Confirmed);
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderConfirmed"]);
}

#[tokio::test]
async fn malformed_or_mismatched_authorization_never_confirms() {
    use std::sync::Arc;
    let store = Arc::new(Memory::default());
    place_order::UseCase::new(store.clone(), fixed()).handle(input("b1")).await.unwrap();
    let confirm = Arc::new(confirm_order::UseCase::new(store.clone()));
    let mut wrong = confirmation("o-b1");
    wrong.amount = Money::of(1, "EUR");
    assert!(matches!(confirm.handle(wrong).await, Err(Error::Payment(_))));
    let mut wrong = confirmation("o-b1");
    wrong.payment_id = "another-payment".into();
    assert!(matches!(confirm.handle(wrong).await, Err(Error::Payment(_))));
    let policy = oms::application::policy::confirm_order_on_payment_authorized::ConfirmOrderOnPaymentAuthorized::new(confirm);
    let malformed = message(
        oms::infrastructure::payments::TOPIC,
        oms::infrastructure::payments::PAYMENT_AUTHORIZED,
        serde_json::json!({"orderId":"o-b1"}),
    );
    assert!(policy.handle(&malformed).await.is_err());
    assert_eq!(store.by_id("o-b1").await.unwrap().status, Status::Placed);
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced"]);
}

#[tokio::test]
async fn payment_outage_is_retried_with_same_id_and_a_decline_is_not_confirmation() {
    use oms::application::order::usecases::request_payment::DeclineReason;
    use oms::application::policy::request_payment_on_order_placed::{ORDER_PLACED, RequestPaymentOnOrderPlaced};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    struct FailingOnce(Arc<AtomicUsize>);
    impl Payments for FailingOnce {
        async fn authorize(&self, payment_id: &str, order_id: &str, amount: &Money) -> Result<Authorization, Error> {
            assert_eq!(payment_id, "o-b1");
            assert_eq!(order_id, "o-b1");
            assert_eq!(*amount, Money::of(900, "EUR"));
            if self.0.fetch_add(1, Ordering::SeqCst) == 0 {
                return Err(Error::Payment("unavailable".into()));
            }
            Ok(Authorization::Declined(DeclineReason::CardRefused))
        }
    }
    let store = Arc::new(Memory::default());
    place_order::UseCase::new(store.clone(), fixed()).handle(input("b1")).await.unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let policy = RequestPaymentOnOrderPlaced::new(
        Arc::new(request_payment::UseCase::new(store.clone(), FailingOnce(calls.clone()))),
        Arc::new(confirm_order::UseCase::new(store.clone())),
        fixed(),
    );
    let placed = message("shop.oms.order", ORDER_PLACED, serde_json::json!({"orderId":"o-b1"}));
    assert!(policy.handle(&placed).await.is_err());
    policy.handle(&placed).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(store.by_id("o-b1").await.unwrap().status, Status::Placed);
}
