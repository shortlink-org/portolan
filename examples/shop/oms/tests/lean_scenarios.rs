//! The use cases held to the Lean model in lean/: every sequence of up to four
//! messages from a small alphabet, run through confirm_order and cancel_order,
//! must end in the status and publish the events `Order.run` computed. The
//! model's properties are proved there; this is what ties them to the code.
//!
//! The fixture is generated, never edited:
//!   cd lean && lake exe scenarios > ../tests/fixtures/order_scenarios.json

mod common;

use std::collections::HashMap;

use common::{Memory, fixed, now};
use oms::application::order::usecases::{cancel_order, confirm_order, place_order};
use oms::domain::order::port::Orders;
use oms::domain::order::vo::Money;
use oms::domain::order::{Error, Line};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    order: Start,
    messages: HashMap<String, Message>,
    scenarios: Vec<Scenario>,
}

#[derive(Deserialize)]
struct Start {
    id: String,
    total: Money,
}

/// `Oms.Msg`, as `msgJson` writes it.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Message {
    Authorized {
        #[serde(rename = "paymentId")]
        payment_id: String,
        amount: Money,
    },
    Declined {
        #[serde(rename = "paymentId")]
        payment_id: String,
    },
    CancelRequested,
}

#[derive(Deserialize)]
struct Scenario {
    messages: Vec<String>,
    status: String,
    events: Vec<String>,
}

#[tokio::test]
async fn the_use_cases_agree_with_the_lean_model() {
    let fixture: Fixture = serde_json::from_str(include_str!("fixtures/order_scenarios.json")).unwrap();
    let mut disagreements = Vec::new();
    for scenario in &fixture.scenarios {
        let (status, events) = replay(&fixture, scenario).await;
        if status != scenario.status || events != scenario.events {
            disagreements.push(format!(
                "{:?}\n    lean: {} {:?}\n    rust: {} {:?}",
                scenario.messages, scenario.status, scenario.events, status, events
            ));
        }
    }
    assert!(
        disagreements.is_empty(),
        "{} of {} scenarios disagree, first ones:\n{}",
        disagreements.len(),
        fixture.scenarios.len(),
        disagreements.iter().take(10).cloned().collect::<Vec<_>>().join("\n")
    );
}

/// Places the fixture's order, applies the scenario's messages in order, and
/// answers with where the order ended and what was published after placing.
async fn replay(fixture: &Fixture, scenario: &Scenario) -> (String, Vec<String>) {
    let store = Memory::default();
    let id = place_order::UseCase::new(&store, fixed())
        .handle(place_order::Input {
            order_id: fixture.order.id.clone(),
            customer_id: "u1".into(),
            basket_id: "b1".into(),
            lines: vec![Line {
                sku: "tea".into(),
                quantity: 2,
                unit_price: Money::of(450, "EUR"),
            }],
            total: fixture.order.total.clone(),
        })
        .await
        .unwrap();
    let confirm = confirm_order::UseCase::new(&store);
    let cancel = cancel_order::UseCase::new(&store, fixed());

    for name in &scenario.messages {
        let result = match &fixture.messages[name] {
            Message::Authorized { payment_id, amount } => {
                confirm
                    .handle(confirm_order::Input {
                        order_id: id.clone(),
                        payment_id: payment_id.clone(),
                        amount: amount.clone(),
                        authorized_at: now(),
                    })
                    .await
            }
            Message::Declined { payment_id } => {
                cancel
                    .handle(cancel_order::Input::payment_declined(id.clone(), payment_id.clone(), "CARD_REFUSED"))
                    .await
            }
            Message::CancelRequested => {
                cancel
                    .handle(cancel_order::Input {
                        order_id: id.clone(),
                        reason: "customer asked".into(),
                        declined_payment_id: None,
                    })
                    .await
            }
        };
        // The model leaves the order alone where Rust refuses a payment that
        // is not this checkout's; any other refusal is a disagreement.
        match result {
            Ok(()) | Err(Error::Payment(_)) => {}
            Err(other) => panic!("{:?}: {name} failed with {other:?}", scenario.messages),
        }
    }

    let status = store.by_id(&id).await.unwrap().status.as_str().to_string();
    let events = store.published.lock().unwrap().iter().skip(1).cloned().collect();
    (status, events)
}
