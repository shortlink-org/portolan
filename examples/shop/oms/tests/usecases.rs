//! The use cases against an in-memory store and a permissive ledger: what
//! each records, what each publishes, and what each refuses. The store is
//! faked here and real in postgres.rs; the domain's rules are tested where
//! they live.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, TimeZone, Utc};
use oms::application::order::usecases::request_payment::{Authorization, DeclineReason, Payments};
use oms::application::order::usecases::{Clock, cancel_order, confirm_order, get_order, place_order, request_payment};
use oms::application::policy::cancel_order_on_payment_declined::CancelOrderOnPaymentDeclined;
use oms::application::policy::confirm_order_on_payment_authorized::ConfirmOrderOnPaymentAuthorized;
use oms::application::policy::place_order_on_basket_checked_out::PlaceOrderOnBasketCheckedOut;
use oms::application::policy::request_payment_on_order_placed::RequestPaymentOnOrderPlaced;
use oms::domain::order::event::{Event, OrderPlaced};
use oms::domain::order::port::Orders;
use oms::domain::order::vo::Money;
use oms::domain::order::{Error, Line, Order, Status};
use oms::infrastructure::cart::BasketCheckedOut;
use oms::infrastructure::ledger::{PaymentAuthorized, PaymentDeclined};

#[derive(Default)]
struct Memory {
    orders: Mutex<Vec<Order>>,
    published: Mutex<Vec<String>>,
    payloads: Mutex<Vec<serde_json::Value>>,
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
        self.payloads.lock().unwrap().extend(events.iter().map(|e| e.payload()));
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
            declined_payment_id: None,
        })
        .await
        .unwrap();
    cancel
        .handle(cancel_order::Input {
            order_id: "o-b1".into(),
            reason: "again".into(),
            declined_payment_id: None,
        })
        .await
        .unwrap();
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderCancelled"]);
    let missing = cancel
        .handle(cancel_order::Input {
            order_id: "nope".into(),
            reason: "x".into(),
            declined_payment_id: None,
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
            declined_payment_id: None,
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

/// OrderPlaced as the outbox renders it and the subscription decodes it back.
fn placed(order_id: &str, basket_id: &str) -> OrderPlaced {
    let event = OrderPlaced {
        order_id: order_id.into(),
        basket_id: basket_id.into(),
        customer_id: "u1".into(),
        total: Money::of(900, "EUR"),
        occurred_at: now(),
    };
    OrderPlaced::decode(&event.payload()).unwrap()
}

/// A ledger that answers every authorisation with the same decline.
struct Declining(Arc<AtomicUsize>);
impl Payments for Declining {
    async fn authorize(&self, _payment_id: &str, _order_id: &str, _total: &Money) -> Result<Authorization, Error> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(Authorization::Declined(DeclineReason::CardRefused))
    }
}

fn request_payment_policy<P: Payments>(store: &Arc<Memory>, payments: P) -> RequestPaymentOnOrderPlaced<Arc<Memory>, P> {
    RequestPaymentOnOrderPlaced::new(
        Arc::new(request_payment::UseCase::new(store.clone(), payments)),
        Arc::new(confirm_order::UseCase::new(store.clone())),
        Arc::new(cancel_order::UseCase::new(store.clone(), fixed())),
        fixed(),
    )
}

#[tokio::test]
async fn actual_cart_wire_places_an_order_and_requests_payment_with_stable_identity() {
    let store = Arc::new(Memory::default());
    let payload = serde_json::from_str(include_str!("../../../scenarios/fixtures/basket-checked-out.json")).unwrap();
    let event = BasketCheckedOut::decode(&payload).unwrap();
    let place = PlaceOrderOnBasketCheckedOut::new(Arc::new(place_order::UseCase::new(store.clone(), fixed())));
    place.handle(&event).await.unwrap();
    place.handle(&event).await.unwrap();
    let policy = request_payment_policy(&store, Permissive);
    let order_placed = placed(&event.basket_id, &event.basket_id);
    policy.handle(&order_placed).await.unwrap();
    policy.handle(&order_placed).await.unwrap();
    let authorized = PaymentAuthorized::decode(&serde_json::from_str(include_str!("../../../scenarios/fixtures/payment-authorized.json")).unwrap()).unwrap();
    let on_authorized = ConfirmOrderOnPaymentAuthorized::new(Arc::new(confirm_order::UseCase::new(store.clone())));
    on_authorized.handle(&authorized).await.unwrap();
    assert_eq!(store.by_id(&event.basket_id).await.unwrap().status, Status::Confirmed);
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderConfirmed"]);
}

#[tokio::test]
async fn malformed_or_mismatched_authorization_never_confirms() {
    let store = Arc::new(Memory::default());
    place_order::UseCase::new(store.clone(), fixed()).handle(input("b1")).await.unwrap();
    let confirm = Arc::new(confirm_order::UseCase::new(store.clone()));
    let mut wrong = confirmation("o-b1");
    wrong.amount = Money::of(1, "EUR");
    assert!(matches!(confirm.handle(wrong).await, Err(Error::Payment(_))));
    let mut wrong = confirmation("o-b1");
    wrong.payment_id = "another-payment".into();
    assert!(matches!(confirm.handle(wrong).await, Err(Error::Payment(_))));
    assert!(PaymentAuthorized::decode(&serde_json::json!({"orderId":"o-b1"})).is_err());
    assert_eq!(store.by_id("o-b1").await.unwrap().status, Status::Placed);
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced"]);
}

#[tokio::test]
async fn payment_outage_is_retried_with_same_id_and_a_decline_cancels_the_order() {
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
    let policy = request_payment_policy(&store, FailingOnce(calls.clone()));
    let order_placed = placed("o-b1", "b1");
    assert!(policy.handle(&order_placed).await.is_err());
    assert_eq!(store.by_id("o-b1").await.unwrap().status, Status::Placed, "an outage is not a decline");
    policy.handle(&order_placed).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(store.by_id("o-b1").await.unwrap().status, Status::Cancelled);
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderCancelled"]);
    assert_eq!(store.payloads.lock().unwrap()[1]["reason"], "payment declined: CARD_REFUSED");
    policy.handle(&order_placed).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2, "a cancelled order asks ledger nothing");
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderCancelled"]);
}

#[tokio::test]
async fn a_declined_payment_cancels_once_whichever_path_says_so_first() {
    let store = Arc::new(Memory::default());
    let payload = serde_json::from_str(include_str!("../../../scenarios/fixtures/basket-checked-out.json")).unwrap();
    let checkout = BasketCheckedOut::decode(&payload).unwrap();
    PlaceOrderOnBasketCheckedOut::new(Arc::new(place_order::UseCase::new(store.clone(), fixed())))
        .handle(&checkout)
        .await
        .unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    request_payment_policy(&store, Declining(calls.clone()))
        .handle(&placed(&checkout.basket_id, &checkout.basket_id))
        .await
        .unwrap();
    let declined = PaymentDeclined::decode(&serde_json::from_str(include_str!("../../../scenarios/fixtures/payment-declined.json")).unwrap()).unwrap();
    assert_eq!(declined.reason, DeclineReason::CardRefused);
    let on_declined = CancelOrderOnPaymentDeclined::new(Arc::new(cancel_order::UseCase::new(store.clone(), fixed())));
    on_declined.handle(&declined).await.unwrap();
    on_declined.handle(&declined).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(store.by_id(&checkout.basket_id).await.unwrap().status, Status::Cancelled);
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderCancelled"]);
}

#[tokio::test]
async fn the_ledger_fact_alone_cancels_a_placed_order_once() {
    let store = Arc::new(Memory::default());
    place_order::UseCase::new(store.clone(), fixed()).handle(input("b1")).await.unwrap();
    let on_declined = CancelOrderOnPaymentDeclined::new(Arc::new(cancel_order::UseCase::new(store.clone(), fixed())));
    let declined = decline("o-b1", "o-b1");
    on_declined.handle(&declined).await.unwrap();
    on_declined.handle(&declined).await.unwrap();
    assert_eq!(store.by_id("o-b1").await.unwrap().status, Status::Cancelled);
    assert_eq!(*store.published.lock().unwrap(), vec!["oms.OrderPlaced", "oms.OrderCancelled"]);
    assert_eq!(store.payloads.lock().unwrap()[1]["reason"], "payment declined: CARD_REFUSED");
}

#[tokio::test]
async fn a_late_or_mismatched_decline_never_cancels() {
    let store = Arc::new(Memory::default());
    place_order::UseCase::new(store.clone(), fixed()).handle(input("b1")).await.unwrap();
    place_order::UseCase::new(store.clone(), fixed()).handle(input("b2")).await.unwrap();
    let on_declined = CancelOrderOnPaymentDeclined::new(Arc::new(cancel_order::UseCase::new(store.clone(), fixed())));
    assert!(matches!(on_declined.handle(&decline("o-b1", "another-payment")).await, Err(Error::Payment(_))));
    assert_eq!(store.by_id("o-b1").await.unwrap().status, Status::Placed);
    confirm_order::UseCase::new(store.clone()).handle(confirmation("o-b2")).await.unwrap();
    on_declined.handle(&decline("o-b2", "o-b2")).await.unwrap();
    assert_eq!(
        store.by_id("o-b2").await.unwrap().status,
        Status::Confirmed,
        "a late decline does not undo a confirmation"
    );
    assert!(
        PaymentDeclined::decode(&serde_json::json!({"paymentId":"o-b1","orderId":"o-b1","reason":"INSUFFICIENT_FUNDS","occurredAt":"2026-09-05T12:00:01Z"}))
            .is_err()
    );
    assert_eq!(
        *store.published.lock().unwrap(),
        vec!["oms.OrderPlaced", "oms.OrderPlaced", "oms.OrderConfirmed"]
    );
}

fn decline(order_id: &str, payment_id: &str) -> PaymentDeclined {
    PaymentDeclined::decode(&serde_json::json!({
        "paymentId": payment_id,
        "orderId": order_id,
        "reason": "CARD_REFUSED",
        "occurredAt": "2026-09-05T12:00:01Z",
    }))
    .unwrap()
}
